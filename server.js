import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new Database('orders.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    items TEXT NOT NULL,
    special_instructions TEXT,
    total REAL,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(cors());
app.use(express.json());

// Serve dashboard
app.use(express.static(join(__dirname, 'dashboard')));

// Webhook endpoint for Vapi
app.post('/api/orders', async (req, res) => {
  try {
    let { businessId, customerName, customerPhone, items, specialInstructions, total } = req.body;
    
    console.log('Received order:', req.body);
    
    // Parse items if it's a string
    let parsedItems;
    if (typeof items === 'string') {
      try {
        parsedItems = JSON.parse(items);
      } catch (e) {
        console.error('Failed to parse items string:', e);
        parsedItems = [{ name: items, quantity: 1, modifications: [] }];
      }
    } else {
      parsedItems = items;
    }
    
    // Generate order number
    const orderNumber = `#${Date.now().toString().slice(-6)}`;
    
    // Save to database
    const insert = db.prepare(`
      INSERT INTO orders (business_id, order_number, customer_name, customer_phone, items, special_instructions, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = insert.run(
      businessId || 'default',
      orderNumber,
      customerName || 'Guest',
      customerPhone || '',
      JSON.stringify(parsedItems),
      specialInstructions || '',
      total || 0
    );
    
    const order = {
      id: result.lastInsertRowid,
      orderNumber,
      businessId: businessId || 'default',
      customerName: customerName || 'Guest',
      customerPhone: customerPhone || '',
      items: parsedItems,
      specialInstructions: specialInstructions || '',
      total: total || 0,
      createdAt: new Date().toISOString()
    };
    
    // Send to printer
    await printOrder(businessId || 'default', order);
    
    res.json({ success: true, order });
  } catch (error) {
    console.error('Error processing order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get orders for dashboard
app.get('/api/orders', (req, res) => {
  const { businessId, status } = req.query;
  
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  
  if (businessId) {
    query += ' AND business_id = ?';
    params.push(businessId);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT 100';
  
  const orders = db.prepare(query).all(...params);
  
  // Parse items JSON
  const formattedOrders = orders.map(order => ({
    ...order,
    items: JSON.parse(order.items)
  }));
  
  res.json(formattedOrders);
});

// Update order status
app.patch('/api/orders/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const update = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
  update.run(status, id);
  
  res.json({ success: true });
});

// Print function (supports PrintNode, CloudPRNT, or custom)
async function printOrder(businessId, order) {
  const printMethod = process.env.PRINT_METHOD;
  
  if (!printMethod) {
    console.log('No print method configured');
    return;
  }
  
  // Format kitchen ticket
  const ticket = formatKitchenTicket(order);
  
  try {
    if (printMethod === 'printnode') {
      await printViaPrintNode(businessId, ticket);
    } else if (printMethod === 'cloudprnt') {
      await printViaCloudPRNT(businessId, ticket);
    } else if (printMethod === 'webhook') {
      await printViaWebhook(businessId, ticket);
    }
  } catch (error) {
    console.error('Print error:', error);
  }
}

function formatKitchenTicket(order) {
  const lines = [];
  lines.push('================================');
  lines.push(`ORDER ${order.orderNumber}     ${new Date().toLocaleTimeString()}`);
  lines.push('================================');
  lines.push('');
  lines.push(`Customer: ${order.customerName}`);
  if (order.customerPhone) {
    lines.push(`Phone: ${order.customerPhone}`);
  }
  lines.push('');
  lines.push('--------------------------------');
  
  order.items.forEach(item => {
    lines.push(`${item.quantity}x ${item.name}`);
    if (item.modifications && item.modifications.length > 0) {
      item.modifications.forEach(mod => {
        lines.push(`   - ${mod}`);
      });
    }
  });
  
  lines.push('--------------------------------');
  
  if (order.specialInstructions) {
    lines.push('');
    lines.push('Special Instructions:');
    lines.push(order.specialInstructions);
  }
  
  lines.push('');
  lines.push(`TOTAL: $${order.total.toFixed(2)}`);
  lines.push('================================');
  lines.push('');
  lines.push('');
  
  return lines.join('\n');
}

async function printViaPrintNode(businessId, content) {
  const apiKey = process.env.PRINTNODE_API_KEY;
  
  if (!apiKey) {
    console.log('PrintNode API key not configured');
    return;
  }
  
  const printerIds = JSON.parse(process.env.PRINTER_IDS || '{}');
  const printerId = printerIds[businessId];
  
  if (!printerId) {
    console.log(`No printer configured for business ${businessId}`);
    console.log('Available business IDs:', Object.keys(printerIds));
    return;
  }
  
  console.log(`Printing to PrintNode printer ${printerId} for business ${businessId}`);
  
  const response = await fetch('https://api.printnode.com/printjobs', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      printerId: parseInt(printerId),
      title: 'Kitchen Order',
      contentType: 'raw_base64',
      content: Buffer.from(content).toString('base64'),
      source: 'Phone Order System'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('PrintNode error:', error);
  } else {
    console.log('Print job sent successfully');
  }
}

async function printViaCloudPRNT(businessId, content) {
  console.log('CloudPRNT implementation pending');
}

async function printViaWebhook(businessId, content) {
  const webhookUrls = JSON.parse(process.env.PRINT_WEBHOOKS || '{}');
  const webhookUrl = webhookUrls[businessId];
  
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, businessId })
    });
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Print method: ${process.env.PRINT_METHOD || 'not configured'}`);
});
