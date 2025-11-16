const API_URL = window.location.origin;
let currentOrders = [];
let lastOrderCount = 0;

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

async function fetchOrders() {
    const businessId = document.getElementById('businessSelect').value;
    const url = businessId ? `${API_URL}/api/orders?businessId=${businessId}` : `${API_URL}/api/orders`;
    
    try {
        const response = await fetch(url);
        const orders = await response.json();
        
        currentOrders = orders;
        renderOrders(orders);
        updateStats(orders);
        
        // Check for new orders and notify
        const newOrderCount = orders.filter(o => o.status === 'new').length;
        if (newOrderCount > lastOrderCount) {
            playNotificationSound();
            showDesktopNotification('New Order Received!', `You have ${newOrderCount} new order(s)`);
        }
        lastOrderCount = newOrderCount;
        
    } catch (error) {
        console.error('Error fetching orders:', error);
    }
}

function renderOrders(orders) {
    const grid = document.getElementById('ordersGrid');
    
    if (orders.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #7f8c8d;">No orders yet. Waiting for phone orders...</div>';
        return;
    }
    
    grid.innerHTML = orders.map(order => `
        <div class="order-card ${order.status}">
            <div class="order-header">
                <div class="order-number">${order.order_number}</div>
                <div class="order-time">${new Date(order.created_at).toLocaleTimeString()}</div>
            </div>
            
            <div class="customer-info">
                <div class="customer-name">${order.customer_name || 'Guest'}</div>
                <div class="customer-phone">${order.customer_phone || 'No phone'}</div>
            </div>
            
            <div class="order-items">
                ${order.items.map(item => `
                    <div class="order-item">
                        <div>
                            <span class="item-quantity">${item.quantity}x</span>
                            <span class="item-name">${item.name}</span>
                            ${item.modifications && item.modifications.length > 0 ? `
                                <div class="item-modifications">
                                    ${item.modifications.map(mod => `• ${mod}`).join('<br>')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            
            ${order.special_instructions ? `
                <div class="special-instructions">
                    <strong>📝 Special Instructions:</strong><br>
                    ${order.special_instructions}
                </div>
            ` : ''}
            
            <div class="order-total">Total: $${order.total.toFixed(2)}</div>
            
            <div class="order-actions">
                ${order.status === 'new' ? `
                    <button class="btn-preparing" onclick="updateOrderStatus(${order.id}, 'preparing')">
                        Start Preparing
                    </button>
                ` : ''}
                ${order.status === 'preparing' ? `
                    <button class="btn-complete" onclick="updateOrderStatus(${order.id}, 'completed')">
                        Mark Complete
                    </button>
                ` : ''}
                <button class="btn-reprint" onclick="reprintOrder(${order.id})">
                    🖨️ Reprint
                </button>
            </div>
        </div>
    `).join('');
}

function updateStats(orders) {
    const newCount = orders.filter(o => o.status === 'new').length;
    const preparingCount = orders.filter(o => o.status === 'preparing').length;
    const completedToday = orders.filter(o => {
        const orderDate = new Date(o.created_at);
        const today = new Date();
        return o.status === 'completed' && 
               orderDate.toDateString() === today.toDateString();
    }).length;
    
    document.getElementById('newOrders').textContent = newCount;
    document.getElementById('preparing').textContent = preparingCount;
    document.getElementById('completed').textContent = completedToday;
}

async function updateOrderStatus(orderId, status) {
    try {
        await fetch(`${API_URL}/api/orders/${orderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        
        fetchOrders();
    } catch (error) {
        console.error('Error updating order:', error);
        alert('Failed to update order status');
    }
}

async function reprintOrder(orderId) {
    // In a real implementation, this would trigger another print job
    alert('Reprint functionality would trigger here. Implement based on your print method.');
}

function playNotificationSound() {
    const audio = document.getElementById('notificationSound');
    audio.play().catch(e => console.log('Could not play sound:', e));
}

function showDesktopNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body,
            icon: '📞',
            requireInteraction: true
        });
    }
}

// Event listeners
document.getElementById('businessSelect').addEventListener('change', fetchOrders);

// Poll for new orders every 5 seconds
setInterval(fetchOrders, 5000);

// Initial fetch
fetchOrders();
