import { Router } from "express";
import { Readable } from "stream";
import { asyncHandler } from "../middleware/errorHandler";

// The dev UI reads its vector basemap directly from Protomaps' public
// PMTiles build server via ranged HTTP GETs (see public/app.js). That works
// fine from Node but never from a browser: build.protomaps.com doesn't send
// Access-Control-Allow-Origin on any response (success or error), so every
// browser blocks it as a CORS failure regardless of network - the app was
// silently falling back to OpenStreetMap's raster tiles for every single
// user, which some networks/browsers also block, leaving the map fully
// blank there. Proxying the ranged reads through our own origin sidesteps
// CORS entirely and removes that OSM dependency for the common case.
export const basemapRouter = Router();

const DATE_PATTERN = /^\d{8}$/;

basemapRouter.get(
  "/:date.pmtiles",
  asyncHandler(async (req, res) => {
    const { date } = req.params;
    if (!DATE_PATTERN.test(date)) {
      res.status(400).json({ error: "Invalid date - expected YYYYMMDD" });
      return;
    }
    const range = req.headers.range;
    if (!range) {
      // protomaps-leaflet always issues ranged reads (the build is well
      // over 100GB); refusing an unranged request avoids ever proxying a
      // full-file download by accident.
      res.status(400).json({ error: "Range header required" });
      return;
    }

    const upstream = await fetch(`https://build.protomaps.com/${date}.pmtiles`, {
      headers: { Range: range },
    });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status === 404 ? 404 : 502).end();
      return;
    }

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    // Each dated build is immutable once published, so client and any
    // intermediate cache can hold onto chunks indefinitely.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
  })
);
