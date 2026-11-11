ALTER TABLE purchase_payments
ADD COLUMN payment_type ENUM('payment', 'refund')
NOT NULL DEFAULT 'payment'
AFTER purchase_id;
