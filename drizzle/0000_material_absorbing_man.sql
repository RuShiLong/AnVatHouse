CREATE TABLE `admin_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`target_customer_id` integer,
	`success` integer NOT NULL,
	`ip` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_reveals` (
	`token_hash` text NOT NULL,
	`customer_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`token_hash`, `customer_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`customer_id` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`note` text NOT NULL,
	`items` text NOT NULL,
	`subtotal` integer NOT NULL,
	`shipping_fee` integer NOT NULL,
	`total` integer NOT NULL,
	`payment` text NOT NULL,
	`payment_paid` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	`customer_id` integer,
	`status_history` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_code_unique` ON `orders` (`code`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`customer_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`weight` text NOT NULL,
	`price` integer NOT NULL,
	`image` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`cart_adds` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);

CREATE TRIGGER products_stock_guard BEFORE UPDATE OF stock ON products
WHEN NEW.stock < 0 OR (NEW.stock < OLD.stock AND (OLD.deleted = 1 OR OLD.active = 0))
BEGIN SELECT RAISE(ABORT, 'Sản phẩm không còn bán hoặc không đủ hàng'); END;

CREATE TRIGGER orders_restore_stock AFTER UPDATE OF status ON orders
WHEN NEW.status = 'cancelled' AND OLD.status != 'cancelled'
BEGIN
  UPDATE products SET stock = stock + COALESCE((SELECT SUM(CAST(json_extract(value, '$.qty') AS INTEGER)) FROM json_each(NEW.items) WHERE CAST(json_extract(value, '$.id') AS INTEGER) = products.id), 0)
  WHERE id IN (SELECT CAST(json_extract(value, '$.id') AS INTEGER) FROM json_each(NEW.items));
END;
