import { integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(), category: text('category').notNull(), weight: text('weight').notNull(),
  price: integer('price').notNull(), image: text('image').notNull(), stock: integer('stock').notNull().default(0),
  active: integer('active').notNull().default(1), description: text('description').notNull().default(''),
  views: integer('views').notNull().default(0), cart_adds: integer('cart_adds').notNull().default(0), deleted: integer('deleted').notNull().default(0),
});
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }), code: text('code').notNull().unique(),
  name: text('name').notNull(), phone: text('phone').notNull(), address: text('address').notNull(), note: text('note').notNull(),
  items: text('items').notNull(), subtotal: integer('subtotal').notNull(), shipping_fee: integer('shipping_fee').notNull(),
  total: integer('total').notNull(), payment: text('payment').notNull(), payment_paid: integer('payment_paid').notNull().default(0),
  status: text('status').notNull().default('new'), created_at: text('created_at').notNull(),
  customer_id: integer('customer_id'), status_history: text('status_history').notNull().default('[]'),
});
export const sessions = sqliteTable('sessions', { token_hash: text('token_hash').primaryKey(), expires_at: integer('expires_at').notNull() });
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }), email: text('email').notNull().unique(),
  password_salt: text('password_salt').notNull(), password_hash: text('password_hash').notNull(),
  name: text('name').notNull().default(''), phone: text('phone').notNull().default(''), address: text('address').notNull().default(''), created_at: text('created_at').notNull(),
});
export const customerSessions = sqliteTable('customer_sessions', { token_hash: text('token_hash').primaryKey(), customer_id: integer('customer_id').notNull(), expires_at: integer('expires_at').notNull() });
export const adminReveals = sqliteTable('admin_reveals', { token_hash: text('token_hash').notNull(), customer_id: integer('customer_id').notNull(), expires_at: integer('expires_at').notNull() }, table => [primaryKey({ columns: [table.token_hash, table.customer_id] })]);
export const adminAuditLogs = sqliteTable('admin_audit_logs', { id: integer('id').primaryKey({ autoIncrement: true }), action: text('action').notNull(), target_customer_id: integer('target_customer_id'), success: integer('success').notNull(), ip: text('ip').notNull(), created_at: text('created_at').notNull() });
export const passwordResetTokens = sqliteTable('password_reset_tokens', { token_hash: text('token_hash').primaryKey(), customer_id: integer('customer_id').notNull(), expires_at: integer('expires_at').notNull(), used_at: text('used_at'), created_at: text('created_at').notNull() });
