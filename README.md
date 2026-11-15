# Yuvomi Modules

Third-party modules for [Yuvomi](https://github.com/ulsklyc/yuvomi).

## Available Modules

### Kids Chores

A household chore and reward management module that integrates Yuvomi with external automation platforms such as Homey.

Features:
- Manage household chores and track completed tasks.
- Send webhook events when tasks are completed.
- Integrate with Homey and other webhook-compatible services.
- Support external point systems and configurable reward rules.
- Trigger rewards such as additional screen time or other Homey-connected features.

### Homey Integration

Kids Chores is designed to communicate with Homey through webhooks. Homey handles the automation logic, point system, reward conditions, and execution of rewards.

Typical workflow:
1. A child completes a chore in Yuvomi.
2. Yuvomi sends a webhook event to Homey.
3. Homey evaluates the completed task against its configured rules and point system.
4. When reward conditions are met, Homey triggers the corresponding action, such as unlocking additional screen time.

### Installation

1. Download or clone this repository.
2. ZIP the `kids-chores` folder.
3. Ensure `module.json` is located at the root of the ZIP archive.
4. In Yuvomi, navigate to **Settings → Modules → Add custom module**.
5. Upload the ZIP archive.

---

More modules and integrations may be added over time.
