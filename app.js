// ==========================================================================
// DURGUZ POS - Application Logic (Firebase Realtime Edition)
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.1/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    updateDoc, 
    doc, 
    onSnapshot, 
    setDoc, 
    getDoc,
    query,
    orderBy,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/11.4.1/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBXn5MazJ43hCNTiE1d_4q5586dq5ze0lo",
  authDomain: "durguzapp-6cd52.firebaseapp.com",
  projectId: "durguzapp-6cd52",
  storageBucket: "durguzapp-6cd52.firebasestorage.app",
  messagingSenderId: "883089633649",
  appId: "1:883089633649:web:da667c731bffbee8d606d0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- State Management ---
const LOCAL_STORAGE_KEY = 'durguz_pos_state';

let state = {
    orders: [], // Array of order objects
    menu: [], // Dynamic menu array
    orderCounter: 1, // Resets daily
    lastDate: new Date().toLocaleDateString(),
    settings: {
        darkMode: false,
        showImages: true,
        autoKitchen: false,
        soundEnabled: true
    },
    // Not synced to Firebase, local UI state
    local: {
        activeView: 'pos',
        selectedOrderId: null,
        draftOrder: null 
    }
};

// Default Menu Data (fallback)
const MENU_DEFAULT = [
    { id: 'm1', name: 'Taco de Birria', price: 25.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=200&h=200&fit=crop', disponible: true },
    { id: 'm2', name: 'Quesabirria', price: 45.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1582880193181-42861e6417fa?w=200&h=200&fit=crop', disponible: true },
    { id: 'm3', name: 'Consomé Chico', price: 25.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1548943487-a2e4f43b4850?w=200&h=200&fit=crop', disponible: true },
    { id: 'm4', name: 'Consomé Grande', price: 40.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1548943487-a2e4f43b4850?w=200&h=200&fit=crop', disponible: true },
    { id: 'm5', name: 'Refresco Cola', price: 20.00, category: 'bebidas', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=200&h=200&fit=crop', disponible: true },
    { id: 'm6', name: 'Agua de Horchata', price: 25.00, category: 'bebidas', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=200&h=200&fit=crop', disponible: true },
    { id: 'm7', name: 'Agua de Jamaica', price: 25.00, category: 'bebidas', image: 'https://images.unsplash.com/photo-1499558008366-41ff8e9da508?w=200&h=200&fit=crop', disponible: true }
];

// --- Firebase Sync initialization ---
async function initFirebaseSync() {
    // 1. Sync Config (Counter, Date, Settings)
    onSnapshot(doc(db, "system", "config"), (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            state.orderCounter = data.orderCounter || 1;
            state.lastDate = data.lastDate || new Date().toLocaleDateString();
            state.settings = { ...state.settings, ...data.settings };
            
            // Check for date reset
            const today = new Date().toLocaleDateString();
            if (state.lastDate !== today) {
                updateDoc(doc.ref, {
                    orderCounter: 1,
                    lastDate: today
                });
            }
            applySettings();
        } else {
            // Init config if it doesn't exist
            setDoc(doc.ref, {
                orderCounter: 1,
                lastDate: new Date().toLocaleDateString(),
                settings: state.settings
            });
        }
    });

    // 2. Sync Menu
    onSnapshot(collection(db, "menu"), (snapshot) => {
        try {
            const menuItems = [];
            snapshot.forEach((doc) => {
                menuItems.push({ id: doc.id, ...doc.data() });
            });
            
            if (menuItems.length === 0) {
                // First time setup: upload default menu
                MENU_DEFAULT.forEach(item => {
                    const { id, ...rest } = item;
                    setDoc(doc(db, "menu", id), rest);
                });
            } else {
                state.menu = menuItems;
                renderMenu();
                renderMenuAdmin();
            }
        } catch (err) {
            console.error("Error processing menu snapshot:", err);
        }
    }, (error) => {
        console.error("Menu Snapshot listener error (check Firestore Rules):", error);
    });

    // 3. Sync Orders
    const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    onSnapshot(ordersQuery, (snapshot) => {
        try {
            const previousOrders = [...state.orders];
            const orders = [];
            snapshot.forEach((doc) => {
                orders.push({ id: doc.id, ...doc.data() });
            });
            state.orders = orders;
            
            // Update draft if it's open
            if (state.local.selectedOrderId) {
                const currentSelected = state.orders.find(o => o.id === state.local.selectedOrderId);
                if (currentSelected) {
                    state.local.draftOrder = JSON.parse(JSON.stringify(currentSelected));
                } else {
                    state.local.selectedOrderId = null;
                    state.local.draftOrder = null;
                }
            }

            // Check for sound notification
            if (state.settings.soundEnabled && state.local.activeView === 'kitchen') {
                const pendingNow = state.orders.filter(o => o.status === 'En cocina').length;
                const pendingBefore = previousOrders.filter(o => o.status === 'En cocina').length;
                if (pendingNow > pendingBefore) {
                    playNotificationSound();
                }
            }

            updateUI();
        } catch (err) {
            console.error("Error processing orders snapshot:", err);
        }
    }, (error) => {
        console.error("Orders Snapshot listener error (check Firestore Rules):", error);
        if (error.code === 'permission-denied') {
            alert("Acceso denegado a la base de datos. Asegúrate de haber configurado las Reglas de Firestore en modo de prueba.");
        }
    });
}

// Migration logic to move data from LocalStorage to Firebase once
async function migrateLocalStorageToFirebase() {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        console.log("Migrating local data to Firebase...");

        // Migrate settings
        if (parsed.settings) {
            await setDoc(doc(db, "system", "config"), {
                settings: parsed.settings,
                orderCounter: parsed.orderCounter || 1,
                lastDate: parsed.lastDate || new Date().toLocaleDateString()
            }, { merge: true });
        }

        // Migrate Menu Items
        if (parsed.menu && parsed.menu.length > 0) {
            for (const item of parsed.menu) {
                const { id, ...rest } = item;
                await setDoc(doc(db, "menu", id), rest);
            }
        }

        // Migrate Orders
        if (parsed.orders && parsed.orders.length > 0) {
            for (const order of parsed.orders) {
                const { id, ...rest } = order;
                await setDoc(doc(db, "orders", id), rest);
            }
        }

        // Clear local storage after successful migration
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        console.log("Migration complete!");
    } catch (e) {
        console.error("Migration failed:", e);
    }
}

// --- Utilities ---
function formatMoney(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

function formatTime(dateObj) {
    return new Date(dateObj).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
        oscillator.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        console.log("Audio not supported or blocked");
    }
}

setInterval(() => {
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = formatTime(new Date());
}, 1000);

// --- Core Actions ---

async function createNewOrder(customerName) {
    const currentCounter = state.orderCounter;
    const newOrder = {
        number: currentCounter,
        customer: customerName,
        items: [],
        status: 'Pendiente', 
        createdAt: new Date().toISOString(),
        notes: '',
        isModified: false
    };

    const docRef = await addDoc(collection(db, "orders"), newOrder);
    
    // Update counter in Firebase
    await updateDoc(doc(db, "system", "config"), {
        orderCounter: currentCounter + 1
    });

    selectOrder(docRef.id);
}

function addItemToDraft(product) {
    if (!state.local.draftOrder) return;
    
    const draft = state.local.draftOrder;
    if (['En cocina', 'Listo'].includes(draft.status)) {
        draft.isModified = true;
        if (state.settings.autoKitchen) {
            draft.status = 'En cocina';
        }
    }

    const existingItem = draft.items.find(i => i.productId === product.id);
    if (existingItem) {
        existingItem.qty++;
    } else {
        draft.items.push({
            productId: product.id,
            name: product.name,
            price: product.price,
            qty: 1
        });
    }
    saveDraftToFirebase();
}

function updateItemQty(productId, delta) {
    if (!state.local.draftOrder) return;
    const draft = state.local.draftOrder;
    const item = draft.items.find(i => i.productId === productId);
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) {
            draft.items = draft.items.filter(i => i.productId !== productId);
        }
        
        if (['En cocina', 'Listo'].includes(draft.status)) {
            draft.isModified = true;
            if (state.settings.autoKitchen) {
                 draft.status = 'En cocina';
            }
        }
        saveDraftToFirebase();
    }
}

async function saveDraftToFirebase() {
    if (state.local.draftOrder && state.local.selectedOrderId) {
        const { id, ...data } = state.local.draftOrder;
        await setDoc(doc(db, "orders", state.local.selectedOrderId), data);
    }
}

function selectOrder(id) {
    state.local.selectedOrderId = id;
    if (id) {
        const order = state.orders.find(o => o.id === id);
        state.local.draftOrder = order ? JSON.parse(JSON.stringify(order)) : null;
    } else {
        state.local.draftOrder = null;
    }
    
    renderActiveOrders();
    renderTicket();
    
    if (window.innerWidth <= 768 && id) {
        // Mobile behavior: show ticket tab
        const ticketBtn = document.querySelector('.mob-tab-btn[data-mob-tab="ticket"]');
        if (ticketBtn) ticketBtn.click();
    }
}

// --- UI Rendering ---

function updateUI() {
    renderActiveOrders();
    renderMenu();
    renderTicket();
    renderKitchen();
    renderStats();
    renderMenuAdmin();
    updateBadges();
}

function applySettings() {
    document.documentElement.setAttribute('data-theme', state.settings.darkMode ? 'dark' : 'light');
    const darkModeToggle = document.getElementById('setting-dark-mode');
    if (darkModeToggle) darkModeToggle.checked = state.settings.darkMode;
    
    const showImgToggle = document.getElementById('setting-show-images');
    if (showImgToggle) showImgToggle.checked = state.settings.showImages;
    
    const autoKitchenToggle = document.getElementById('setting-auto-kitchen');
    if (autoKitchenToggle) autoKitchenToggle.checked = state.settings.autoKitchen;
    
    const soundToggle = document.getElementById('toggle-sound');
    if (soundToggle) soundToggle.checked = state.settings.soundEnabled;
    
    renderMenu(); 
}

function updateBadges() {
    const kitchenCount = state.orders.filter(o => o.status === 'En cocina').length;
    const badge = document.getElementById('kitchen-badge');
    if (badge) {
        if (kitchenCount > 0) {
            badge.textContent = kitchenCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    
    const mobBadge = document.getElementById('mob-ticket-badge');
    if (mobBadge) {
        const draftCount = state.local.draftOrder ? state.local.draftOrder.items.length : 0;
        if (draftCount > 0) {
            mobBadge.textContent = draftCount;
            mobBadge.classList.remove('hidden');
        } else {
            mobBadge.classList.add('hidden');
        }
    }
}

function renderActiveOrders() {
    const list = document.getElementById('active-orders-list');
    if (!list) return;
    
    const activeOrders = state.orders.filter(o => ['Pendiente', 'En cocina', 'Listo'].includes(o.status));
    list.innerHTML = '';
    
    if (activeOrders.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--text-muted); margin-top: 2rem;">No hay pedidos activos.</p>';
        return;
    }

    activeOrders.forEach(order => {
        const isSelected = order.id === state.local.selectedOrderId;
        const total = order.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
        
        const card = document.createElement('div');
        card.className = `order-card ${isSelected ? 'selected' : ''}`;
        card.onclick = () => selectOrder(order.id);
        
        let statusClass = `badge-${order.status.replace(' ', '').toLowerCase()}`;
        if (order.isModified) statusClass = 'badge-modificado';

        card.innerHTML = `
            <div class="order-card-header">
                <h4>${order.customer}</h4>
                <span class="status-badge ${statusClass}">${order.isModified ? 'MODIFICADO' : order.status}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <p>#${order.number} - ${formatTime(order.createdAt)}</p>
                <strong>${formatMoney(total)}</strong>
            </div>
        `;
        list.appendChild(card);
    });
}

function renderMenu(category = 'all') {
    const grid = document.getElementById('menu-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    const availableMenu = state.menu.filter(m => m.disponible !== false);
    const filtered = category === 'all' ? availableMenu : availableMenu.filter(m => m.category === category);
    
    filtered.forEach(product => {
        const btn = document.createElement('div');
        btn.className = 'product-btn';
        btn.onclick = () => {
            if (!state.local.draftOrder) {
                alert("Primero crea o selecciona un pedido.");
                return;
            }
            addItemToDraft(product);
        };
        
        let imgHtml = '';
        if (state.settings.showImages && product.image) {
            imgHtml = `<img src="${product.image}" class="product-image" loading="lazy">`;
        } else {
            let icon = product.category === 'bebidas' ? 'local_bar' : 'tapas';
            imgHtml = `<div class="product-image" style="display:flex;align-items:center;justify-content:center;font-family:'Material Symbols Rounded';font-size:3rem;color:var(--text-muted)">${icon}</div>`;
        }

        btn.innerHTML = `
            ${imgHtml}
            <span class="product-name">${product.name}</span>
            <span class="product-price">${formatMoney(product.price)}</span>
        `;
        grid.appendChild(btn);
    });
}

function renderTicket() {
    const panel = document.getElementById('ticket-panel');
    const emptyState = panel.querySelector('.ticket-state-empty');
    const activeState = panel.querySelector('.ticket-state-active');
    
    if (!state.local.draftOrder) {
        panel.classList.add('empty');
        emptyState.classList.remove('hidden');
        activeState.classList.add('hidden');
        return;
    }
    
    panel.classList.remove('empty');
    emptyState.classList.add('hidden');
    activeState.classList.remove('hidden');
    
    const draft = state.local.draftOrder;
    
    document.getElementById('ticket-customer').textContent = draft.customer;
    document.getElementById('ticket-order-number').textContent = `#${draft.number}`;
    
    const statusEl = document.getElementById('ticket-status');
    statusEl.textContent = draft.isModified ? 'MODIFICADO' : draft.status;
    statusEl.className = `order-status status-badge badge-${draft.isModified ? 'modificado' : draft.status.replace(' ', '').toLowerCase()}`;
    
    const itemsContainer = document.getElementById('ticket-items');
    itemsContainer.innerHTML = '';
    
    let total = 0;
    draft.items.forEach(item => {
        const subtotal = item.price * item.qty;
        total += subtotal;
        
        const row = document.createElement('div');
        row.className = 'ticket-item';
        row.innerHTML = `
            <div class="item-info">
                <div class="item-name">${item.name}</div>
                <div class="item-price">${formatMoney(item.price)}</div>
            </div>
            <div class="item-controls">
                <button class="qty-btn" id="dec-${item.productId}">-</button>
                <span class="item-qty">${item.qty}</span>
                <button class="qty-btn" id="inc-${item.productId}">+</button>
            </div>
            <div class="item-subtotal">${formatMoney(subtotal)}</div>
        `;
        itemsContainer.appendChild(row);
        
        document.getElementById(`dec-${item.productId}`).onclick = () => updateItemQty(item.productId, -1);
        document.getElementById(`inc-${item.productId}`).onclick = () => updateItemQty(item.productId, 1);
    });
    
    const notesDisplay = document.getElementById('ticket-notes-display');
    if (draft.notes) {
        notesDisplay.textContent = draft.notes;
        notesDisplay.classList.remove('hidden');
    } else {
        notesDisplay.classList.add('hidden');
    }
    
    document.getElementById('ticket-total').textContent = formatMoney(total);
    
    const btnSend = document.getElementById('btn-send-kitchen');
    const btnCharge = document.getElementById('btn-charge');
    
    if (draft.status === 'Pendiente' || (draft.isModified && !state.settings.autoKitchen)) {
        btnSend.classList.remove('hidden');
        btnSend.innerHTML = draft.isModified ? '<span class="material-symbols-rounded">update</span>Actualizar Cocina' : '<span class="material-symbols-rounded">send</span>En Cocina';
    } else {
        btnSend.classList.add('hidden');
    }
    
    btnCharge.disabled = draft.items.length === 0;
}

function renderKitchen() {
    const list = document.getElementById('kitchen-orders-list');
    if (!list) return;
    
    const kitchenOrders = state.orders.filter(o => o.status === 'En cocina');
    list.innerHTML = '';
    
    if (kitchenOrders.length === 0) {
         list.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 3rem; color:var(--text-muted); font-size:1.25rem;">No hay pedidos en cola.</div>';
         return;
    }
    
    kitchenOrders.forEach(order => {
        const card = document.createElement('div');
        card.className = `kitchen-order ${order.isModified ? 'modificado' : ''}`;
        
        let itemsHtml = order.items.map(i => `
            <div class="ko-item">
                <span class="ko-qty">${i.qty}</span>
                <span class="ko-name">${i.name}</span>
            </div>
        `).join('');
        
        let notesHtml = order.notes ? `<div class="ko-notes">${order.notes}</div>` : '';
        let modHtml = order.isModified ? `<div style="background:var(--danger);color:white;text-align:center;font-weight:700;padding:4px;">PEDIDO MODIFICADO</div>` : '';

        card.innerHTML = `
            ${modHtml}
            <div class="ko-header">
                <strong>Ticket #${order.number}</strong>
                <span class="ko-time">${formatTime(order.createdAt)}</span>
            </div>
            <div class="ko-customer">${order.customer}</div>
            <div class="ko-items">
                ${itemsHtml}
            </div>
            ${notesHtml}
            <div class="ko-actions">
                <button class="btn-ready" id="ready-${order.id}">
                    <span class="material-symbols-rounded">check_circle</span>
                    Marcar como Listo
                </button>
            </div>
        `;
        list.appendChild(card);
        document.getElementById(`ready-${order.id}`).onclick = () => markOrderReady(order.id);
    });
}

async function markOrderReady(id) {
    await updateDoc(doc(db, "orders", id), {
        status: 'Listo',
        isModified: false
    });
}

function renderStats() {
    const paidOrders = state.orders.filter(o => o.status === 'Pagado');
    const canceledOrders = state.orders.filter(o => o.status === 'Cancelado');
    
    let totalIncome = 0;
    const itemCounts = {};
    
    paidOrders.forEach(o => {
        o.items.forEach(i => {
            totalIncome += i.price * i.qty;
            itemCounts[i.name] = (itemCounts[i.name] || 0) + i.qty;
        });
    });
    
    const totalEl = document.getElementById('stat-total');
    if (totalEl) totalEl.textContent = formatMoney(totalIncome);
    
    const paidCountEl = document.getElementById('stat-paid-count');
    if (paidCountEl) paidCountEl.textContent = paidOrders.length;
    
    const canceledCountEl = document.getElementById('stat-canceled-count');
    if (canceledCountEl) canceledCountEl.textContent = canceledOrders.length;
    
    const sortedItems = Object.entries(itemCounts).sort((a,b) => b[1] - a[1]);
    const topList = document.getElementById('top-products-list');
    if (topList) {
        topList.innerHTML = '';
        sortedItems.slice(0, 5).forEach(([name, count]) => {
            topList.innerHTML += `<li><span>${name}</span> <strong>${count} uds</strong></li>`;
        });
        if (sortedItems.length === 0) topList.innerHTML = '<li style="color:var(--text-muted)">Sin datos aún.</li>';
    }

    const historyList = document.getElementById('history-list');
    if (historyList) {
        historyList.innerHTML = '';
        const historyOrders = [...paidOrders, ...canceledOrders].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,10);
        historyOrders.forEach(o => {
            const total = o.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
            const color = o.status === 'Pagado' ? 'var(--success)' : 'var(--danger)';
            historyList.innerHTML += `
                <div style="display:flex; justify-content:space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-light);">
                    <div>
                        <strong>#${o.number} - ${o.customer}</strong>
                        <div style="font-size:0.85rem; color:${color}; font-weight:600;">${o.status.toUpperCase()}</div>
                    </div>
                    <strong>${formatMoney(total)}</strong>
                </div>
            `;
        });
        if (historyOrders.length === 0) {
            historyList.innerHTML = '<div style="padding:1rem;color:var(--text-muted);">El historial está vacío.</div>';
        }
    }
}

function renderMenuAdmin() {
    const list = document.getElementById('admin-products-list');
    if (!list) return;

    list.innerHTML = '';
    state.menu.forEach(product => {
        let isAvailable = product.disponible !== false;
        const card = document.createElement('div');
        card.className = `admin-product-card ${!isAvailable ? 'unavailable' : ''}`;
        
        let imgHtml = '';
        if (product.image) {
            imgHtml = `<img src="${product.image}" class="ap-img">`;
        } else {
            let icon = product.category === 'bebidas' ? 'local_bar' : 'tapas';
            imgHtml = `<div class="ap-img" style="display:flex;align-items:center;justify-content:center;font-family:'Material Symbols Rounded';color:var(--text-muted);font-size:1.5rem;">${icon}</div>`;
        }

        card.innerHTML = `
            <div class="ap-info">
                ${imgHtml}
                <div class="ap-details">
                    <span class="ap-name">${product.name}</span>
                    <span class="ap-price">${formatMoney(product.price)}</span>
                </div>
            </div>
            <div class="ap-actions">
                <button class="btn-icon edit" id="edit-${product.id}">
                    <span class="material-symbols-rounded">edit</span>
                </button>
                <button class="btn-icon delete" id="del-${product.id}">
                    <span class="material-symbols-rounded">delete</span>
                </button>
                <label class="toggle-switch" style="margin-left: 0.5rem;">
                    <input type="checkbox" id="tog-${product.id}" ${isAvailable ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
        `;
        list.appendChild(card);
        
        document.getElementById(`edit-${product.id}`).onclick = () => editProduct(product.id);
        document.getElementById(`del-${product.id}`).onclick = () => deleteProduct(product.id);
        document.getElementById(`tog-${product.id}`).onchange = () => toggleProduct(product.id);
    });
}

function editProduct(id) {
    const product = state.menu.find(p => p.id === id);
    if (!product) return;

    document.getElementById('modal-product-title').textContent = 'Editar Producto';
    document.getElementById('input-product-id').value = product.id;
    document.getElementById('input-product-name').value = product.name;
    document.getElementById('input-product-price').value = product.price;
    document.getElementById('input-product-category').value = product.category;
    document.getElementById('input-product-image').value = product.image || '';
    document.getElementById('input-product-available').checked = product.disponible !== false;

    document.getElementById('modal-product').classList.remove('hidden');
}

async function deleteProduct(id) {
    if (confirm("¿Seguro que deseas eliminar este producto? Esto no afectará a los pedidos existentes.")) {
        await deleteDoc(doc(db, "menu", id));
    }
}

async function toggleProduct(id) {
    const product = state.menu.find(p => p.id === id);
    if (product) {
        await updateDoc(doc(db, "menu", id), {
            disponible: product.disponible === false ? true : false
        });
    }
}

// --- Event Listeners Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DURGUZ POS: Starting initialization...");
    
    try {
        // First, try migration
        await migrateLocalStorageToFirebase();
        
        // Init Realtime Sync
        initFirebaseSync();
        
        console.log("DURGUZ POS: Firebase sync initialized.");
    } catch (err) {
        console.error("DURGUZ POS: Critical error during Firebase initialization:", err);
        alert("Error al conectar con la base de datos. El sistema podría no responder.");
    }

    try {
        // Setup Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                const targetBtn = e.currentTarget;
                targetBtn.classList.add('active');
                
                const view = targetBtn.dataset.view;
                state.local.activeView = view;
                
                document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active', 'hidden'));
                document.querySelectorAll('.view-section').forEach(sec => {
                    if (sec.id === `view-${view}`) sec.classList.add('active');
                    else sec.classList.add('hidden');
                });

                if (view === 'kitchen') renderKitchen();
                if (view === 'menu-admin') renderMenuAdmin();
            });
        });

        // Mobile Bottom Nav
        const mobTabBtns = document.querySelectorAll('.mob-tab-btn');
        mobTabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                mobTabBtns.forEach(b => b.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                
                const tab = target.dataset.mobTab;
                
                if (tab === 'pedidos' || tab === 'menu' || tab === 'ticket') {
                    state.local.activeView = 'pos';
                    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
                    document.getElementById('view-pos').classList.remove('hidden');
                    document.getElementById('view-pos').classList.add('active');
                    
                    const panels = {
                        'pedidos': '.orders-panel',
                        'menu': '.menu-panel',
                        'ticket': '.ticket-panel'
                    };
                    document.querySelectorAll('.panel').forEach(p => p.classList.remove('mobile-active'));
                    document.querySelector(panels[tab]).classList.add('mobile-active');
                    document.getElementById('mob-mas-menu').classList.add('hidden');
                    
                } else if (tab === 'mas') {
                    document.getElementById('mob-mas-menu').classList.remove('hidden');
                }
            });
        });

        document.querySelector('.btn-close-mas').addEventListener('click', () => {
            document.getElementById('mob-mas-menu').classList.add('hidden');
            let activePanel = null;
            if(document.querySelector('.orders-panel').classList.contains('mobile-active')) activePanel = 'pedidos';
            else if(document.querySelector('.menu-panel').classList.contains('mobile-active')) activePanel = 'menu';
            else if(document.querySelector('.ticket-panel').classList.contains('mobile-active')) activePanel = 'ticket';
            
            mobTabBtns.forEach(b => b.classList.remove('active'));
            if (activePanel) {
                document.querySelector(`.mob-tab-btn[data-mob-tab="${activePanel}"]`).classList.add('active');
            }
        });

        document.querySelectorAll('.mob-mas-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                document.getElementById('mob-mas-menu').classList.add('hidden');
                
                document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active', 'hidden'));
                document.querySelectorAll('.view-section').forEach(sec => {
                    if (sec.id === `view-${view}`) sec.classList.add('active');
                    else sec.classList.add('hidden');
                });
                
                if (view === 'kitchen') renderKitchen();
                if (view === 'menu-admin') renderMenuAdmin();
            });
        });

        if (window.innerWidth <= 768) {
            document.querySelector('.orders-panel').classList.add('mobile-active');
            document.querySelector('.mob-tab-btn[data-mob-tab="pedidos"]').classList.add('active');
        }

        document.querySelectorAll('.cat-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
                e.currentTarget.classList.add('active');
                renderMenu(e.currentTarget.dataset.category);
            });
        });

        const modalNewOrder = document.getElementById('modal-new-order');
        const modalAddNote = document.getElementById('modal-add-note');
        const modalPayment = document.getElementById('modal-payment');
        const modalProduct = document.getElementById('modal-product');

        document.getElementById('btn-add-product').addEventListener('click', () => {
            document.getElementById('modal-product-title').textContent = 'Agregar Producto';
            document.getElementById('input-product-id').value = '';
            document.getElementById('input-product-name').value = '';
            document.getElementById('input-product-price').value = '';
            document.getElementById('input-product-image').value = '';
            document.getElementById('input-product-available').checked = true;
            modalProduct.classList.remove('hidden');
        });

        document.getElementById('btn-cancel-product').addEventListener('click', () => {
            modalProduct.classList.add('hidden');
        });

        document.getElementById('btn-save-product').addEventListener('click', async () => {
            const id = document.getElementById('input-product-id').value;
            const name = document.getElementById('input-product-name').value.trim();
            const price = parseFloat(document.getElementById('input-product-price').value);
            const category = document.getElementById('input-product-category').value;
            const image = document.getElementById('input-product-image').value.trim();
            const disponible = document.getElementById('input-product-available').checked;

            if (!name || isNaN(price)) {
                alert('Nombre y precio son requeridos y deben ser válidos.');
                return;
            }

            const data = { name, price, category, image, disponible };

            if (id) {
                await updateDoc(doc(db, "menu", id), data);
            } else {
                await addDoc(collection(db, "menu"), data);
            }
            modalProduct.classList.add('hidden');
        });

        document.getElementById('btn-new-order').addEventListener('click', () => {
            const inp = document.getElementById('input-customer-name');
            inp.value = '';
            modalNewOrder.classList.remove('hidden');
            inp.focus();
        });

        document.getElementById('btn-cancel-new-order').addEventListener('click', () => {
            modalNewOrder.classList.add('hidden');
        });

        document.getElementById('btn-confirm-new-order').addEventListener('click', () => {
            const name = document.getElementById('input-customer-name').value.trim();
            if (name) {
                createNewOrder(name);
                modalNewOrder.classList.add('hidden');
            } else {
                alert("El nombre es requerido");
            }
        });

        document.getElementById('btn-add-note').addEventListener('click', () => {
            if (!state.local.draftOrder) return;
            document.getElementById('input-note').value = state.local.draftOrder.notes || '';
            modalAddNote.classList.remove('hidden');
            document.getElementById('input-note').focus();
        });

        document.getElementById('btn-cancel-note').addEventListener('click', () => modalAddNote.classList.add('hidden'));

        document.getElementById('btn-save-note').addEventListener('click', async () => {
            if (!state.local.draftOrder || !state.local.selectedOrderId) return;
            const notes = document.getElementById('input-note').value.trim();
            
            let status = state.local.draftOrder.status;
            let isModified = state.local.draftOrder.isModified;

            if (['En cocina', 'Listo'].includes(status)) {
                isModified = true;
                if (state.settings.autoKitchen) status = 'En cocina';
            }
            
            await updateDoc(doc(db, "orders", state.local.selectedOrderId), {
                notes, status, isModified
            });
            modalAddNote.classList.add('hidden');
        });

        document.getElementById('btn-send-kitchen').addEventListener('click', async () => {
            if (!state.local.selectedOrderId) return;
            await updateDoc(doc(db, "orders", state.local.selectedOrderId), {
                status: 'En cocina',
                isModified: false
            });
        });

        document.getElementById('btn-cancel-order').addEventListener('click', async () => {
            if (!state.local.selectedOrderId) return;
            if (confirm("¿Estás seguro de cancelar este pedido?")) {
                await updateDoc(doc(db, "orders", state.local.selectedOrderId), {
                    status: 'Cancelado'
                });
                selectOrder(null);
            }
        });

        let paymentTotal = 0;
        
        document.getElementById('btn-charge').addEventListener('click', () => {
            if (!state.local.draftOrder) return;
            if (state.local.draftOrder.items.length === 0) return;
            
            paymentTotal = state.local.draftOrder.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
            document.getElementById('payment-order-number').textContent = `#${state.local.draftOrder.number}`;
            document.getElementById('payment-total-amount').textContent = formatMoney(paymentTotal);
            
            document.getElementById('input-cash-received').value = '';
            document.getElementById('payment-change').textContent = formatMoney(0);
            
            const qcContainer = document.getElementById('quick-cash-buttons');
            qcContainer.innerHTML = '';
            [50, 100, 200, 500].forEach(val => {
                if (val >= paymentTotal || (val === 500 && paymentTotal < 500)) {
                    const b = document.createElement('button');
                    b.className = 'btn-quick-cash';
                    b.textContent = `$${val}`;
                    b.onclick = () => receiveCash(val);
                    qcContainer.appendChild(b);
                }
            });

            const bEx = document.createElement('button');
            bEx.className = 'btn-quick-cash';
            bEx.textContent = 'Exacto';
            bEx.onclick = () => receiveCash(paymentTotal);
            qcContainer.appendChild(bEx);

            modalPayment.classList.remove('hidden');
        });

        document.getElementById('btn-cancel-payment').addEventListener('click', () => modalPayment.classList.add('hidden'));

        document.querySelectorAll('.method-card').forEach(card => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.method-card').forEach(c => c.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                if (e.currentTarget.dataset.method === 'cash') {
                    document.getElementById('payment-cash-panel').classList.remove('hidden');
                    document.getElementById('payment-transfer-panel').classList.add('hidden');
                } else {
                    document.getElementById('payment-cash-panel').classList.add('hidden');
                    document.getElementById('payment-transfer-panel').classList.remove('hidden');
                }
            });
        });

        const cashInput = document.getElementById('input-cash-received');
        cashInput.addEventListener('input', (e) => {
            const received = parseFloat(e.target.value) || 0;
            const change = received - paymentTotal;
            const changeEl = document.getElementById('payment-change');
            changeEl.textContent = formatMoney(change);
            changeEl.className = `change-amount ${change >= 0 ? 'positive' : 'negative'}`;
        });

        document.getElementById('btn-confirm-payment').addEventListener('click', async () => {
            if (!state.local.selectedOrderId) return;
            
            const activeMethod = document.querySelector('.method-card.active').dataset.method;
            if (activeMethod === 'cash') {
                const received = parseFloat(cashInput.value) || 0;
                if (received < paymentTotal) {
                    alert("El efectivo recibido es menor al total.");
                    return;
                }
            }
            
            await updateDoc(doc(db, "orders", state.local.selectedOrderId), {
                status: 'Pagado'
            });
            selectOrder(null);
            modalPayment.classList.add('hidden');
        });

        window.receiveCash = function(amount) {
            const input = document.getElementById('input-cash-received');
            input.value = amount;
            input.dispatchEvent(new Event('input'));
        };

        document.getElementById('setting-dark-mode').addEventListener('change', async (e) => {
            await updateDoc(doc(db, "system", "config"), {
                "settings.darkMode": e.target.checked
            });
        });
        
        document.getElementById('setting-show-images').addEventListener('change', async (e) => {
            await updateDoc(doc(db, "system", "config"), {
                "settings.showImages": e.target.checked
            });
        });

        document.getElementById('setting-auto-kitchen').addEventListener('change', async (e) => {
            await updateDoc(doc(db, "system", "config"), {
                "settings.autoKitchen": e.target.checked
            });
        });

        document.getElementById('toggle-sound').addEventListener('change', async (e) => {
            await updateDoc(doc(db, "system", "config"), {
                "settings.soundEnabled": e.target.checked
            });
        });

        document.getElementById('btn-end-day').addEventListener('click', async () => {
            if(confirm("¿Seguro que deseas cerrar la caja? Esto archivará todos los pedidos pagados y cancelados en la nube.")) {
                const batch = [];
                state.orders.forEach(o => {
                    if (['Pagado', 'Cancelado'].includes(o.status)) {
                        deleteDoc(doc(db, "orders", o.id));
                    }
                });
                
                await updateDoc(doc(db, "system", "config"), {
                    orderCounter: 1
                });
                alert("Caja cerrada exitosamente.");
            }
        });

        updateUI();
        console.log("DURGUZ POS: Initialization complete and UI rendered.");

    } catch (err) {
        console.error("DURGUZ POS: Error during event listeners setup:", err);
    }
});
