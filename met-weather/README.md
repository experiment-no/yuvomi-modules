# Weather

A Norway-only weather page for Yuvomi. The hours come from MET Locationforecast. The overview tile opens a graph that switches between one day and two days.

Install the folder as a custom module. Yuvomi does not run anything in this folder, and the page cannot call MET itself.

Zip it so `module.json` is at the archive root:

```sh
cd met-weather && zip -r ../met-weather.zip .
```

Settings → Modules → Add custom module, then enable Weather. Updating from GitHub asks to replace the installed version with the version in this file. Confirming that replace turns the module off. Turn Weather on again under Active modules, then reload the overview.

The graph stays empty until a place is saved and the service below is running.

## Service

A separate Node process fetches the forecast. It does not read or write `yuvomi.db`. Yuvomi will not start it.

```sh
YUVOMI_INTERNAL_URL=http://127.0.0.1:3000 node service/server.js
```

It listens on `127.0.0.1:3012` and only serves `/api/extensions/met-weather`. The saved place is `data/met-weather/place.json` (mode `0600`). Override the path with `MET_WEATHER_STATE`.

The service checks the browser session with `GET {YUVOMI_INTERNAL_URL}/api/v1/auth/me` and the cookie the browser sent. Saving a place requires an administrator and the header `X-Met-Weather-CSRF`. Anyone who can open the module can read the forecast.

MET is called as `yuvomi-met-weather/1.0 https://github.com/experiment-no/yuvomi-modules`. Coordinates are rounded to four decimal places. A response is kept until its `Expires` header, and the next request sends `If-Modified-Since`. Place search uses Kartverket's stedsnavn register, and the server stores the place id, then resolves the coordinates again before asking MET.

The page credits [Meteorologisk institutt](https://www.met.no/) and [Kartverket](https://www.kartverket.no/).

### nginx

Forward the prefix and keep it. `proxy_pass` has no path, so `/api/extensions/met-weather` reaches the service unchanged. Host, Cookie, and X-Forwarded-Proto are required for the session and the origin check.

```nginx
location /api/extensions/met-weather/ {
    proxy_pass http://127.0.0.1:3012;
    proxy_set_header Host $host;
    proxy_set_header Cookie $http_cookie;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

The overview lists this tile as Weather, or Vær when the language is Norwegian. It is on by default. The tile file is `widgets/forecast.js` (`renderWidget`). A click opens `/m/met-weather`, where the graph and the hour table follow the same 24 or 48 hours.
