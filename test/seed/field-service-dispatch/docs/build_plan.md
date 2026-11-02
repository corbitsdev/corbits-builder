# Build Plan: Field Service Dispatch Board

## Data Model

- `technicians`: `id`, `name`, `zone`, `shift_status`, `certifications_json`, `phone`.
- `work_orders`: `id`, `code`, `customer_name`, `site_address`, `priority`, `required_skill`, `status`, `assigned_technician_id`, `sla_due_at`, `notes`.
- `dispatch_events`: `id`, `work_order_id`, `event_type`, `summary`, `created_at`.

## API Routes

- `GET /api/dispatch/board`: Returns work orders, technicians, and SLA summary metrics.
- `POST /api/work-orders`: Creates a new emergency or scheduled work order.
- `POST /api/work-orders/:id/assign`: Assigns or reassigns a technician and records a dispatch event.
- `POST /api/work-orders/:id/status`: Transitions work-order status and timestamps completion.

## Acceptance Checklist

- [ ] Dispatch queue filters work orders by status, priority, and search query.
- [ ] Assigning a technician updates the work order to Dispatched and logs a dispatch event.
- [ ] Advancing status through En Route, On Site, and Completed updates KPI counters.
