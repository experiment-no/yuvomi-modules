# Weather

Weather data from the Norwegian Meteorological Institute, on a page for Yuvomi. The overview tile opens a view that switches between one day and two days.

Install the folder as a custom module. Yuvomi does not run anything in this folder, and the page cannot call MET itself. Opening the page still works: it reads the forecast Yuvomi already fetches for the household. Pick a place in Norway under Settings, and that place is saved as the household weather location.

Zip it so `module.json` is at the archive root:

```sh
cd met-weather && zip -r ../met-weather.zip .
```

Settings → Modules → Add custom module, then enable Weather. Updating from GitHub asks to replace the installed version with the version in this file. Confirming that replace turns the module off. Turn Weather on again under Active modules, then reload the overview.

Until a place in Norway is saved, the page says so. It does not ask for a separate process.

## Service

An optional Node process fetches MET Locationforecast and draws the hours. It does not read or write `yuvomi.db`. Yuvomi will not start it. Without it, the page uses Yuvomi's weather API instead of the hour graph.

```sh
YUVOMI_INTERNAL_URL=http://127.0.0.1:3000 node service/server.js
```

It listens on `127.0.0.1:3012` and only serves `/api/extensions/met-weather`. The saved place is `data/met-weather/place.json` (mode `0600`). Override the path with `MET_WEATHER_STATE`.

The service checks the browser session with `GET {YUVOMI_INTERNAL_URL}/api/v1/auth/me` and the cookie the browser sent. Saving a place requires an administrator and the header `X-Met-Weather-CSRF`. Anyone who can open the module can read the forecast.

MET is called as `yuvomi-met-weather/1.0 https://github.com/experiment-no/yuvomi-modules`. Coordinates are rounded to four decimal places. A response is kept until its `Expires` header, and the next request sends `If-Modified-Since`. Place search uses Kartverket's stedsnavn register, and the server stores the place id, then resolves the coordinates again before asking MET.

With the service running, the page credits [Meteorologisk institutt](https://www.met.no/) and [Kartverket](https://www.kartverket.no/). Without it, the same credit names Meteorologisk institutt and [Open-Meteo](https://open-meteo.com/), which is what delivers the forecast through Yuvomi.

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
