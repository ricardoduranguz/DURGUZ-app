// ==========================================================================
// DURGUZ POS - Application Logic
// ==========================================================================

// --- State Management ---
const LOCAL_STORAGE_KEY = 'durguz_pos_state';
const syncChannel = new BroadcastChannel('durguz-pos-sync');

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
    // Not synced, local UI state
    local: {
        activeView: 'pos',
        selectedOrderId: null,
        draftOrder: null // the order currently being edited/viewed in the ticket
    }
};

// Menu Data
const MENU = [
    { id: 'm1', name: 'Taco de Birria', price: 25.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=200&h=200&fit=crop' },
    { id: 'm2', name: 'Quesabirria', price: 45.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1582880193181-42861e6417fa?w=200&h=200&fit=crop' },
    { id: 'm3', name: 'Consomé Chico', price: 25.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1548943487-a2e4f43b4850?w=200&h=200&fit=crop' },
    { id: 'm4', name: 'Consomé Grande', price: 40.00, category: 'tacos', image: 'https://images.unsplash.com/photo-1548943487-a2e4f43b4850?w=200&h=200&fit=crop' },
    { id: 'm5', name: 'Refresco Cola', price: 20.00, category: 'bebidas', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=200&h=200&fit=crop' },
    { id: 'm6', name: 'Agua de Horchata', price: 25.00, category: 'bebidas', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=200&h=200&fit=crop' },
    { id: 'm7', name: 'Agua de Jamaica', price: 25.00, category: 'bebidas', image: 'https://images.unsplash.com/photo-1499558008366-41ff8e9da508?w=200&h=200&fit=crop' }
];

// Load from local storage
function loadState() {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // check day reset
            const today = new Date().toLocaleDateString();
            if (parsed.lastDate !== today) {
                parsed.orderCounter = 1;
                parsed.lastDate = today;
                // keep only non-completed orders or wipe day? Let's just reset counter
            }
            state = { ...state, ...parsed, local: state.local };
            if (!state.menu || state.menu.length === 0) {
                state.menu = JSON.parse(JSON.stringify(MENU));
            }
        } catch (e) {
            console.error('Failed to load state', e);
        }
    } else {
        state.menu = JSON.parse(JSON.stringify(MENU));
    }
    applySettings();
}

function saveState() {
    const toSave = { ...state };
    delete toSave.local; // don't save UI state
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
    syncChannel.postMessage({ type: 'STATE_UPDATE', payload: toSave });
}

syncChannel.onmessage = (event) => {
    if (event.data.type === 'STATE_UPDATE') {
        const previousOrders = state.orders;
        state = { ...state, ...event.data.payload };
        
        // Check for new kitchen orders to play sound
        if (state.settings.soundEnabled && state.local.activeView === 'kitchen') {
            const pendingNow = state.orders.filter(o => o.status === 'En cocina').length;
            const pendingBefore = previousOrders.filter(o => o.status === 'En cocina').length;
            if (pendingNow > pendingBefore) {
                playNotificationSound();
            }
        }
        updateUI();
    }
};

// --- Utilities ---
function formatMoney(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

function formatTime(dateObj) {
    return new Date(dateObj).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function playNotificationSound() {
    // Simple beep using Web Audio API to avoid needing external files
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
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

// Update clock
setInterval(() => {
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = formatTime(new Date());
}, 1000);

// --- Core Actions ---

function getOrder(id) {
    return state.orders.find(o => o.id === id);
}

function createNewOrder(customerName) {
    const newOrder = {
        id: 'ord_' + Date.now(),
        number: state.orderCounter++,
        customer: customerName,
        items: [],
        status: 'Pendiente', // Pendiente, En cocina, Listo, Pagado, Cancelado
        createdAt: new Date().toISOString(),
        notes: '',
        isModified: false
    };
    state.orders.push(newOrder);
    selectOrder(newOrder.id);
    saveState();
    updateUI();
}

function addItemToDraft(product) {
    if (!state.local.draftOrder) return;
    
    // Check if order is already processed, if so we are modifying it
    if (['En cocina', 'Listo'].includes(state.local.draftOrder.status)) {
        state.local.draftOrder.isModified = true;
        if (state.settings.autoKitchen) {
             state.local.draftOrder.status = 'En cocina';
        }
    }

    const existingItem = state.local.draftOrder.items.find(i => i.productId === product.id);
    if (existingItem) {
        existingItem.qty++;
    } else {
        state.local.draftOrder.items.push({
            productId: product.id,
            name: product.name,
            price: product.price,
            qty: 1
        });
    }
    syncDraftToState();
}

function updateItemQty(productId, delta) {
    if (!state.local.draftOrder) return;
    const item = state.local.draftOrder.items.find(i => i.productId === productId);
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) {
            state.local.draftOrder.items = state.local.draftOrder.items.filter(i => i.productId !== productId);
        }
        
        if (['En cocina', 'Listo'].includes(state.local.draftOrder.status)) {
            state.local.draftOrder.isModified = true;
            if (state.settings.autoKitchen) {
                 state.local.draftOrder.status = 'En cocina';
            }
        }
        syncDraftToState();
    }
}

function syncDraftToState() {
    if (state.local.draftOrder) {
        const index = state.orders.findIndex(o => o.id === state.local.draftOrder.id);
        if (index > -1) {
            state.orders[index] = { ...state.local.draftOrder };
            saveState();
            renderTicket();
        }
    }
}

function selectOrder(id) {
    state.local.selectedOrderId = id;
    if (id) {
        const order = getOrder(id);
        // deep copy for draft
        state.local.draftOrder = JSON.parse(JSON.stringify(order));
    } else {
        state.local.draftOrder = null;
    }
    renderActiveOrders();
    renderTicket();
    
    // mobile slide up
    if (window.innerWidth <= 768 && id) {
        document.getElementById('ticket-panel').classList.add('active-mobile');
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
    document.getElementById('setting-dark-mode').checked = state.settings.darkMode;
    document.getElementById('setting-show-images').checked = state.settings.showImages;
    document.getElementById('setting-auto-kitchen').checked = state.settings.autoKitchen;
    document.getElementById('toggle-sound').checked = state.settings.soundEnabled;
    renderMenu(); // Re-render menu to show/hide images
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
}

// 1. Orders List
function renderActiveOrders() {
    const list = document.getElementById('active-orders-list');
    if (!list) return;
    
    // Show only active orders in POS (Pendiente, En cocina, Listo)
    const activeOrders = state.orders.filter(o => ['Pendiente', 'En cocina', 'Listo'].includes(o.status));
    
    // Sort descending by creation
    activeOrders.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    
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

// 2. Menu
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
                // optional: prompt new order or show error?
                // for speed, if no order selected, maybe open new order modal?
                alert("Primero crea o selecciona un pedido.");
                return;
            }
            addItemToDraft(product);
        };
        
        let imgHtml = '';
        if (state.settings.showImages && product.image) {
            imgHtml = `<img src="${product.image}" class="product-image" loading="lazy">`;
        } else {
            // fallback icon
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

// 3. Ticket
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
    
    // Items
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
                <button class="qty-btn" onclick="updateItemQty('${item.productId}', -1)">-</button>
                <span class="item-qty">${item.qty}</span>
                <button class="qty-btn" onclick="updateItemQty('${item.productId}', 1)">+</button>
            </div>
            <div class="item-subtotal">${formatMoney(subtotal)}</div>
        `;
        itemsContainer.appendChild(row);
    });
    
    // Notes
    const notesDisplay = document.getElementById('ticket-notes-display');
    if (draft.notes) {
        notesDisplay.textContent = draft.notes;
        notesDisplay.classList.remove('hidden');
    } else {
        notesDisplay.classList.add('hidden');
    }
    
    // Total
    document.getElementById('ticket-total').textContent = formatMoney(total);
    
    // Buttons logic based on status
    const btnSend = document.getElementById('btn-send-kitchen');
    const btnCharge = document.getElementById('btn-charge');
    
    // If pending, allow send to kitchen
    if (draft.status === 'Pendiente' || (draft.isModified && !state.settings.autoKitchen)) {
        btnSend.classList.remove('hidden');
        if (draft.isModified) {
            btnSend.innerHTML = '<span class="material-symbols-rounded">update</span>Actualizar Cocina';
        } else {
            btnSend.innerHTML = '<span class="material-symbols-rounded">send</span>En Cocina';
        }
    } else {
        btnSend.classList.add('hidden');
    }
    
    // Always visible, but only enabled if there are items
    btnCharge.disabled = draft.items.length === 0;
}

// 4. Kitchen
function renderKitchen() {
    const list = document.getElementById('kitchen-orders-list');
    if (!list) return;
    
    const kitchenOrders = state.orders.filter(o => o.status === 'En cocina');
    kitchenOrders.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)); // oldest first
    
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
                <button class="btn-ready" onclick="markOrderReady('${order.id}')">
                    <span class="material-symbols-rounded">check_circle</span>
                    Marcar como Listo
                </button>
            </div>
        `;
        list.appendChild(card);
    });
}

function markOrderReady(id) {
    const index = state.orders.findIndex(o => o.id === id);
    if (index > -1) {
        state.orders[index].status = 'Listo';
        state.orders[index].isModified = false; // Reset modification flag since it was acknowledged
        saveState();
        if (state.local.draftOrder && state.local.draftOrder.id === id) {
             state.local.draftOrder = { ...state.orders[index] };
             renderTicket();
        }
        updateUI();
    }
}

// 5. Stats
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
    
    if (document.getElementById('stat-total')) document.getElementById('stat-total').textContent = formatMoney(totalIncome);
    if (document.getElementById('stat-paid-count')) document.getElementById('stat-paid-count').textContent = paidOrders.length;
    if (document.getElementById('stat-canceled-count')) document.getElementById('stat-canceled-count').textContent = canceledOrders.length;
    
    // Top products
    const sortedItems = Object.entries(itemCounts).sort((a,b) => b[1] - a[1]);
    const topList = document.getElementById('top-products-list');
    if (topList) {
        topList.innerHTML = '';
        sortedItems.slice(0, 5).forEach(([name, count]) => {
            topList.innerHTML += `<li><span>${name}</span> <strong>${count} uds</strong></li>`;
        });
        if (sortedItems.length === 0) topList.innerHTML = '<li style="color:var(--text-muted)">Sin datos aún.</li>';
    }

    // History
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

// 6. Admin Menu
function renderMenuAdmin() {
    const list = document.getElementById('admin-products-list');
    if (!list) return;

    list.innerHTML = '';
    
    if (state.menu.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No hay productos en el menú.</p>';
        return;
    }

    state.menu.forEach(product => {
        let isAvailable = product.disponible !== false;
        const card = document.createElement('div');
        card.className = `admin-product-card ${!isAvailable ? 'unavailable' : ''}`;
        
        // Icon if no image
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
                <button class="btn-icon edit" onclick="window.editProduct('${product.id}')">
                    <span class="material-symbols-rounded">edit</span>
                </button>
                <button class="btn-icon delete" onclick="window.deleteProduct('${product.id}')">
                    <span class="material-symbols-rounded">delete</span>
                </button>
                <label class="toggle-switch" style="margin-left: 0.5rem;">
                    <input type="checkbox" ${isAvailable ? 'checked' : ''} onchange="window.toggleProduct('${product.id}')">
                    <span class="slider round"></span>
                </label>
            </div>
        `;
        list.appendChild(card);
    });
}

window.editProduct = function(id) {
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
};

window.deleteProduct = function(id) {
    if (confirm("¿Seguro que deseas eliminar este producto? Esto no afectará a los pedidos existentes.")) {
        state.menu = state.menu.filter(p => p.id !== id);
        saveState();
        updateUI();
    }
};

window.toggleProduct = function(id) {
    const index = state.menu.findIndex(p => p.id === id);
    if (index > -1) {
        state.menu[index].disponible = state.menu[index].disponible === false ? true : false;
        saveState();
        updateUI();
    }
};

// --- Event Listeners Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    
    // Load state
    loadState();
    
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

            // Re-render kitchen when viewed to sync any missed states visually
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
                // Ensure we are in POS view
                state.local.activeView = 'pos';
                document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
                document.getElementById('view-pos').classList.remove('hidden');
                document.getElementById('view-pos').classList.add('active');
                
                // Toggle panels
                const panels = {
                    'pedidos': '.orders-panel',
                    'menu': '.menu-panel',
                    'ticket': '.ticket-panel'
                };
                document.querySelectorAll('.panel').forEach(p => p.classList.remove('mobile-active'));
                document.querySelector(panels[tab]).classList.add('mobile-active');
                
                // Hide Mas menu if open
                document.getElementById('mob-mas-menu').classList.add('hidden');
                
            } else if (tab === 'mas') {
                document.getElementById('mob-mas-menu').classList.remove('hidden');
            }
        });
    });

    // Close "Mas" menu
    document.querySelector('.btn-close-mas').addEventListener('click', () => {
        document.getElementById('mob-mas-menu').classList.add('hidden');
        // Restore active tab highlight based on current panel
        let activePanel = null;
        if(document.querySelector('.orders-panel').classList.contains('mobile-active')) activePanel = 'pedidos';
        else if(document.querySelector('.menu-panel').classList.contains('mobile-active')) activePanel = 'menu';
        else if(document.querySelector('.ticket-panel').classList.contains('mobile-active')) activePanel = 'ticket';
        
        mobTabBtns.forEach(b => b.classList.remove('active'));
        if (activePanel) {
            document.querySelector(`.mob-tab-btn[data-mob-tab="${activePanel}"]`).classList.add('active');
        }
    });

    // Mas Menu Buttons (navigating to specific views)
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

    // Initialize mobile view default (Pedidos panel)
    if (window.innerWidth <= 768) {
        document.querySelector('.orders-panel').classList.add('mobile-active');
        document.querySelector('.mob-tab-btn[data-mob-tab="pedidos"]').classList.add('active');
    }

    // POS Categories
    document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            e.currentTarget.classList.add('active');
            renderMenu(e.currentTarget.dataset.category);
        });
    });

    // Modals
    const modalNewOrder = document.getElementById('modal-new-order');
    const modalAddNote = document.getElementById('modal-add-note');
    const modalPayment = document.getElementById('modal-payment');
    const modalProduct = document.getElementById('modal-product');

    // Menu Admin Modal Actions
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

    document.getElementById('btn-save-product').addEventListener('click', () => {
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

        if (id) {
            // Editing
            const index = state.menu.findIndex(p => p.id === id);
            if (index > -1) {
                state.menu[index] = { ...state.menu[index], name, price, category, image, disponible };
            }
        } else {
            // Adding
            const newProduct = {
                id: 'prod_' + Date.now(),
                name,
                price,
                category,
                image,
                disponible
            };
            state.menu.push(newProduct);
        }

        saveState();
        updateUI();
        modalProduct.classList.add('hidden');
    });

    // New Order Logic
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

    // Notes Logic
    document.getElementById('btn-add-note').addEventListener('click', () => {
        if (!state.local.draftOrder) return;
        document.getElementById('input-note').value = state.local.draftOrder.notes || '';
        modalAddNote.classList.remove('hidden');
        document.getElementById('input-note').focus();
    });

    document.getElementById('btn-cancel-note').addEventListener('click', () => modalAddNote.classList.add('hidden'));

    document.getElementById('btn-save-note').addEventListener('click', () => {
        if (!state.local.draftOrder) return;
        state.local.draftOrder.notes = document.getElementById('input-note').value.trim();
        
        if (['En cocina', 'Listo'].includes(state.local.draftOrder.status)) {
            state.local.draftOrder.isModified = true;
            if (state.settings.autoKitchen) state.local.draftOrder.status = 'En cocina';
        }
        
        syncDraftToState();
        modalAddNote.classList.add('hidden');
    });

    // Send to kitchen
    document.getElementById('btn-send-kitchen').addEventListener('click', () => {
        if (!state.local.draftOrder) return;
        state.local.draftOrder.status = 'En cocina';
        state.local.draftOrder.isModified = false;
        syncDraftToState();
    });

    // Cancel order
    document.getElementById('btn-cancel-order').addEventListener('click', () => {
        if (!state.local.draftOrder) return;
        if (confirm("¿Estás seguro de cancelar este pedido?")) {
            state.local.draftOrder.status = 'Cancelado';
            syncDraftToState();
            selectOrder(null); // deselect
        }
    });

    // Payment Logic
    let paymentTotal = 0;
    
    document.getElementById('btn-charge').addEventListener('click', () => {
        if (!state.local.draftOrder) return;
        if (state.local.draftOrder.items.length === 0) return;
        
        paymentTotal = state.local.draftOrder.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
        document.getElementById('payment-order-number').textContent = `#${state.local.draftOrder.number}`;
        document.getElementById('payment-total-amount').textContent = formatMoney(paymentTotal);
        
        // Reset Inputs
        document.getElementById('input-cash-received').value = '';
        document.getElementById('payment-change').textContent = formatMoney(0);
        
        // Generate quick cash buttons
        const qcContainer = document.getElementById('quick-cash-buttons');
        qcContainer.innerHTML = '';
        [50, 100, 200, 500].forEach(val => {
            if (val >= paymentTotal || (val === 500 && paymentTotal < 500)) {
                qcContainer.innerHTML += `<button class="btn-quick-cash" onclick="receiveCash(${val})">$${val}</button>`;
            }
        });

        // Add exact amount button
        qcContainer.innerHTML += `<button class="btn-quick-cash" onclick="receiveCash(${paymentTotal})">Exacto</button>`;

        modalPayment.classList.remove('hidden');
    });

    document.getElementById('btn-cancel-payment').addEventListener('click', () => modalPayment.classList.add('hidden'));

    // Payment method tabs
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

    document.getElementById('btn-confirm-payment').addEventListener('click', () => {
        if (!state.local.draftOrder) return;
        
        const activeMethod = document.querySelector('.method-card.active').dataset.method;
        if (activeMethod === 'cash') {
            const received = parseFloat(cashInput.value) || 0;
            if (received < paymentTotal) {
                alert("El efectivo recibido es menor al total.");
                return;
            }
        }
        
        state.local.draftOrder.status = 'Pagado';
        syncDraftToState();
        selectOrder(null);
        modalPayment.classList.add('hidden');
    });

    window.receiveCash = function(amount) {
        const input = document.getElementById('input-cash-received');
        input.value = amount;
        input.dispatchEvent(new Event('input'));
    };

    // Settings
    document.getElementById('setting-dark-mode').addEventListener('change', (e) => {
        state.settings.darkMode = e.target.checked;
        saveState();
        applySettings();
    });
    
    document.getElementById('setting-show-images').addEventListener('change', (e) => {
        state.settings.showImages = e.target.checked;
        saveState();
        renderMenu(); // Re-render menu specifically
    });

    document.getElementById('setting-auto-kitchen').addEventListener('change', (e) => {
        state.settings.autoKitchen = e.target.checked;
        saveState();
    });

    document.getElementById('toggle-sound').addEventListener('change', (e) => {
        state.settings.soundEnabled = e.target.checked;
        saveState();
    });

    // End Day
    document.getElementById('btn-end-day').addEventListener('click', () => {
        if(confirm("¿Seguro que deseas cerrar la caja? Esto archivará todos los pedidos pagados y cancelados, y reiniciará el contador.")) {
            // Keep only pending, en cocina, listo
            state.orders = state.orders.filter(o => ['Pendiente', 'En cocina', 'Listo'].includes(o.status));
            state.orderCounter = 1;
            saveState();
            updateUI();
            alert("Caja cerrada exitosamente.");
        }
    });

    // Start UI
    updateUI();
});
