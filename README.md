# Yuvomi Modules

Third-party modules for [Yuvomi](https://github.com/ulsklyc/yuvomi).

## Available Modules

### Kids Chores

A household chore and reward management module designed to support external automation and reward systems.

Features:
- Manage household chores and track completed tasks.
- Send webhook events when tasks are completed.
- Integrate with external webhook-compatible services.
- Support external point systems and configurable reward rules.
- Enable rewards such as additional screen time or other connected services and devices.

### Weather

A Norway-only forecast from MET Locationforecast. The overview tile opens a graph with a one-day view and a two-day view. Place search uses Kartverket, and the hours are fetched by a small service that runs beside Yuvomi. The page is available in Norwegian and English.

### External Integrations such as Homey and Home Assistant

Kids Chores is designed to communicate with external services through webhooks. This allows users to connect their own automation platforms and implement custom rules, point systems, and reward mechanisms.

For example, an automation platform such as Homey could receive task completion events, evaluate reward conditions, and trigger actions such as unlocking additional screen time or other connected features.
