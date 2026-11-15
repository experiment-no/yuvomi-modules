# Kids Chores

A household chore list for Yuvomi. Install the folder as a custom module. Yuvomi does not run anything in this folder.

Zip it so `module.json` is at the archive root:

```sh
cd kids-chores && zip -r ../kids-chores.zip .
```

Settings → Modules → Add custom module, then enable Kids Chores. With no reverse proxy the page stores chores in this browser under `kids-chores.state.v1`. Reloading keeps them. Another browser does not see them.

Updating from GitHub asks to replace the installed version with the version in this file. Confirming that replace turns the module off. Turn Kids Chores on again under Active modules, then reload the overview. The overview tile stays hidden while the module is off.

## Optional service

A separate Node process can answer the same API. It does not read or write `yuvomi.db`. Yuvomi will not start it.

```sh
YUVOMI_INTERNAL_URL=http://127.0.0.1:3000 node service/server.js
```

It listens on `127.0.0.1:3011` and only serves `/api/extensions/kids-chores`. State is `data/kids-chores/state.json` (mode `0600`). Override the path with `KIDS_CHORES_STATE`.

The service checks the browser session with `GET {YUVOMI_INTERNAL_URL}/api/v1/auth/me` and the cookie the browser sent. Writes require header `X-Kids-Chores-CSRF`. The webhook URL is returned only to an admin on the chores and settings responses.

When that prefix returns real JSON, the page uses it and stops reading local storage for those requests.

### nginx

Forward the prefix and keep it. `proxy_pass` has no path, so `/api/extensions/kids-chores` reaches the service unchanged. Host, Cookie, and X-Forwarded-Proto are required for the session and the origin check.

```nginx
location /api/extensions/kids-chores/ {
    proxy_pass http://127.0.0.1:3011;
    proxy_set_header Host $host;
    proxy_set_header Cookie $http_cookie;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

The overview lists this tile as Kids Chores. It is on by default, so it sits in the grid. The chips above the grid are only the widgets that were hidden. The tile file is `widgets/today.js` (`renderWidget`). The today sheet on the overview loads the same day through `browser.js` (`choresApi('/today')`) and completes a chore with `choresApi('/complete')`. This folder does not patch the dashboard; those calls are already in the overview.

`showOnWall` and `notifyAdmin` are stored with the household settings. `wall.js` exports `renderWallPanel` for an overview that already mounts it. The panel stays empty until show on wall is on and today has a scheduled chore. Stock Yuvomi does not mount that panel.
