# Problem Brief: Field Service Dispatch Board

## Problem Statement

Regional HVAC and commercial electrical dispatchers coordinate 15 to 40 field technicians across overlapping service windows. When emergency calls arrive or a job runs over its window, dispatchers struggle to see which qualified technician is closest, who has capacity, and which SLA timers are within 30 minutes of breaching.

## Target Users

- **Lead Dispatcher**: Assigns unassigned work orders, rebalances routes, and monitors SLA countdowns.
- **Operations Supervisor**: Reviews completion rates, on-time arrival metrics, and parts holds.

## Core Workflows

1. Triage incoming and unassigned work orders sorted by priority (`Emergency`, `High`, `Routine`) and SLA deadline.
2. Match a work order to an available technician with matching certifications (`HVAC-R`, `High Voltage`, `Boiler`).
3. Transition work orders through `Unassigned` → `Dispatched` → `En Route` → `On Site` → `Completed`.
4. Resolve or reassign jobs flagged in the SLA At-Risk strip.
