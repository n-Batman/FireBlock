# National Weather Service connection

The real parcel map displays hourly forecast wind (the upper end of a range), relative humidity, temperature, forecast description, issue time and active Red Flag Warnings. It follows the initial Downtown SLO location, address search and coordinate/map picks. These are forecasts, not station observations. Weather does not modify satellite risk scores.

`GET /api/weather?lat=35.2828&lon=-120.6596` returns `application/geo+json`: a FeatureCollection with a point forecast as its first feature and active alert features preserving their NWS geometry (which can be null for zone alerts). Save the response as `.geojson` for GIS use. Coordinates use longitude, latitude order. The forecast includes its valid interval, source and issue time.

The backend resolves `/points/{lat},{lon}` to `forecastHourly`, requests `/alerts/active?point={lat},{lon}`, and sends `Accept: application/geo+json` plus `User-Agent: FireBlock/0.1 (https://github.com/n-Batman/FireBlock)`. The project URL identifies this application without inventing a contact email. Override `NWS_USER_AGENT` in `.env` and your hosting provider's server environment with your preferred application identity and real support URL or email. No NWS key or browser credential is required.

The NWS application User-Agent and GeoJSON conventions are documented at https://www.weather.gov/documentation/services-web-api . Forecast URLs are restricted to the NWS API host and gridpoint hourly path. Requests time out after 10 seconds. Next.js caches point mappings for one day, forecasts for five minutes and alerts for one minute; the browser refreshes every five minutes and cancels old location requests. The point mapping is periodically resolved again because NWS grids can change.

Missing forecast data is unavailable rather than replaced with sample values. An alert failure produces unknown Red Flag status, never a false all-clear. Only actual, unexpired alerts whose onset has passed count; future warnings do not indicate a currently active warning. Expired forecast periods are hidden. The strip does not display the old sample wildfire count.

Run `node node_modules/vitest/vitest.mjs run src/lib/weather.test.ts src/app/api/weather/route.test.ts src/lib/useWeather.test.tsx src/components/WeatherStrip.test.tsx` and `node node_modules/typescript/bin/tsc --noEmit`.
