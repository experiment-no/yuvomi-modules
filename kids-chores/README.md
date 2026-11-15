# Kids Chores

A household chore list for Yuvomi. Install the folder as a custom module. Yuvomi does not run anything in this folder.

Zip it so `module.json` is at the archive root:

```sh
cd kids-chores && zip -r ../kids-chores.zip .
```

Settings → Modules → Add custom module, then enable Kids Chores. With no sidecar, the page stores the household list in a Yuvomi note titled Kids Chores. Every signed-in member can read that note, so a generic chore created by an administrator shows up for the rest of the household, and a chore linked to one person shows only for them. Each person's check-offs are kept in a note they can update themselves, titled Kids Chores log. Leave both notes alone. A check-off by someone who is not an administrator counts immediately. Yuvomi only lets an administrator send the Homey webhook, so that call waits for an administrator session and then uses the same address and the same JSON. Keep the overview open on the administrator account and it goes out within a few seconds. The first time Kids Chores opens in a browser that already has chores, and the Kids Chores note does not exist yet, that list is copied into the note. Open Kids Chores once on the computer where the chores were created after installing this version.

If the notes cannot be read, the page keeps the old browser-only copy under `kids-chores.state.v1`. Another browser does not see that copy.

The optional service below is another way to share the list. When `/api/extensions/kids-chores` answers, the page uses it instead of the note. The first device that opens Kids Chores copies a browser-only list onto the service when the service list is still empty.

Sync across users is on by default. A chore with nobody checked is generic and shows for every member. Check a child to link it only to that child. Everyone links it to each child, and you can clear the ones who should not have it. I follow is how a parent chooses which children's chores to see, in addition to the generic ones. Turning sync off keeps a separate list per account. The same account still shares that list across its devices. Chores saved before this version still show for everyone until you edit them and check the right child.

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
