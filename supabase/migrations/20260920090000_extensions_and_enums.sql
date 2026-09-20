-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto" with schema public;
create extension if not exists "postgis" with schema public;

-- Enums -----------------------------------------------------------------
create type user_role as enum ('parent', 'admin');
create type verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type seller_type as enum ('parent', 'business');
create type product_condition as enum ('new', 'like_new', 'good', 'fair');
create type product_status as enum ('draft', 'active', 'sold', 'archived', 'removed');
create type fulfilment_type as enum ('collection', 'delivery');
create type payment_method as enum ('online', 'cash');
create type order_status as enum (
  'pending_payment',
  'confirmed',
  'ready_for_collection',
  'awaiting_delivery',
  'in_transit',
  'completed',
  'cancelled',
  'disputed',
  'refunded'
);
create type payment_status as enum ('pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded');
create type payout_status as enum ('pending', 'processing', 'paid', 'failed');
create type refund_status as enum ('requested', 'approved', 'rejected', 'processed');
create type delivery_service_level as enum ('cheapest', 'standard', 'express');
create type delivery_order_status as enum (
  'pending',
  'booked',
  'collected_by_courier',
  'in_transit',
  'delivered',
  'failed',
  'cancelled'
);
create type subscription_status as enum ('active', 'cancelled', 'past_due', 'expired');
create type promotion_status as enum ('pending_payment', 'active', 'expired', 'cancelled');
create type report_target_type as enum ('product', 'profile', 'business', 'message', 'review');
create type report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
create type dispute_status as enum ('open', 'under_review', 'resolved_buyer', 'resolved_seller', 'resolved_partial', 'closed');
create type actor_type as enum ('system', 'buyer', 'seller', 'admin', 'delivery_provider', 'payment_provider');
create type account_standing as enum ('good', 'warned', 'suspended');
