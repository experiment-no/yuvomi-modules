# Weather

Weather data from the Norwegian Meteorological Institute, on a page for Yuvomi. The overview tile shows the weather at once: the temperature now, the next four days, and the graph. It does not leave the overview.

Install the folder as a custom module. Yuvomi does not run anything in this folder, and the page cannot call MET itself. Opening the page still works: it reads the forecast Yuvomi already fetches for the household. Pick a place in Norway under Settings, and that place is saved as the household weather location.

Zip it so `module.json` is at the archive root:

```sh
cd met-weather && zip -r ../met-weather.zip .
```

Settings → Modules → Add custom module, then enable Weather. Updating from GitHub asks to replace the installed version with the version in this file. Confirming that replace turns the module off. Turn Weather on again under Active modules, then reload the overview.

Until a place in Norway is saved, the page says so. It does not ask for a separate process.

## Service

An optional Node process fetches MET Locationforecast and keeps ten days, including gusts and the maximum precipitation when MET sends them. It does not read or write `yuvomi.db`. Yuvomi will not start it. Without it, the page asks Open-Meteo for the MET Nordic hours (ten days, every hour). If that request cannot leave the page, it uses the daily forecast Yuvomi already fetches.

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

The overview lists this tile as Weather, or Vær when the language is Norwegian. It is on by default, wider so the four days fit, and tall enough for the graph. The tile file is `widgets/forecast.js` (`renderWidget`). The temperature, the next four days and the graph are visible together: temperature, precipitation, wind, gust and the direction the wind is blowing. The overview graph is two panels. Temperature and precipitation are on top, with the temperature line warm above freezing and cold below it. Wind is the solid line underneath, gust is the dashed line, and the arrows under that panel show where the wind is blowing. When the forecast only has the wind measured now, that speed is the wind point for today. The graph uses the same surface, text and chart colours as the rest of Yuvomi. The page at `/m/met-weather` lists each day on its own row (eight or more when the forecast has them): night, morning, afternoon and evening, high and low, precipitation and wind. A row opens that day. When the hours are available it lists all twenty-four.
