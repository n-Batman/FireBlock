import { getWeather, weatherCoordinates, WeatherError } from "@/lib/weather";

export async function GET(request: Request) {
  try {
    const { lat, lon } = weatherCoordinates(new URL(request.url).searchParams);
    return Response.json(await getWeather(lat, lon), {
      headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=60" },
    });
  } catch (error) {
    const known = error instanceof WeatherError;
    return Response.json({ error: known ? error.message : "Weather is unavailable. Try again shortly." }, {
      status: known ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
