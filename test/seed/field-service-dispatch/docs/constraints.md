# Constraints: Field Service Dispatch Board

## Operational & Domain Constraints

- **Certification matching**: A work order requiring `High Voltage` or `Commercial Chiller` certification warns the dispatcher if assigned to a technician without that active certification.
- **Explicit status state machine**: Work orders move through `unassigned`, `dispatched`, `en_route`, `on_site`, `parts_hold`, and `completed`.
- **SLA breach visibility**: Any open emergency work order within 30 minutes of its response deadline surfaces in the top SLA Alert banner.

## Interface Constraints

- **List-detail split**: Dispatchers inspect a work order's site notes, contact phone, required parts, and candidate technicians without losing sight of the queue.
