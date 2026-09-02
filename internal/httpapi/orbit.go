// Package httpapi — orbit HTTP handlers (Flask-compatible JSON over gRPC).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "noaa21_orbit/api/proto/orbit/v1"
	"noaa21_orbit/internal/clients"
)

// OrbitHandlers maps orbit HTTP routes to the orbit gRPC client.
type OrbitHandlers struct {
	Orbit *clients.OrbitClient
}

// Register mounts all orbit API routes on mux.
func (h *OrbitHandlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("/health", h.handleHealth)
	mux.HandleFunc("/api/health", h.handleHealth)
	mux.HandleFunc("/api/satellites", h.handleListSatellites)
	mux.HandleFunc("/api/tle", h.handleGetTLE)
	mux.HandleFunc("/api/current", h.handleCurrentPosition)
	mux.HandleFunc("/api/track", h.handleTrack)
	mux.HandleFunc("/api/orbit-info", h.handleOrbitInfo)
	mux.HandleFunc("/api/swath", h.handleSwath)
	mux.HandleFunc("/api/polar-crossings", h.handlePolarCrossings)
	mux.HandleFunc("/api/equator-crossings", h.handlePolarCrossings)
	mux.HandleFunc("/api/coverage-heatmap", h.handleCoverageHeatmap)
	mux.HandleFunc("/api/constellation/current", h.handleConstellationCurrent)
	mux.HandleFunc("/api/fires", h.handleFires)
	mux.HandleFunc("/api/passes", h.handleSitePasses)
	RegisterAstroProxies(mux, h)
}

func CorsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		log.Printf("json encode: %v", err)
	}
}

func writeRPCError(w http.ResponseWriter, err error) {
	log.Printf("RPC error: %v", err)
	code := http.StatusInternalServerError
	msg := err.Error()
	if st, ok := status.FromError(err); ok {
		msg = st.Message()
		switch st.Code() {
		case codes.InvalidArgument:
			code = http.StatusBadRequest
		case codes.NotFound:
			code = http.StatusNotFound
		case codes.Unimplemented:
			code = http.StatusNotImplemented
		case codes.Unavailable:
			code = http.StatusServiceUnavailable
		}
	}
	writeJSON(w, code, map[string]string{"error": msg})
}

func (h *OrbitHandlers) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	_, err := h.Orbit.ListSatellites(ctx, &pb.ListSatellitesRequest{})
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "degraded",
			"grpc":   "down",
			"error":  err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "orbit-edge",
		"grpc":    "up",
	})
}

func (h *OrbitHandlers) handleListSatellites(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	res, err := h.Orbit.ListSatellites(ctx, &pb.ListSatellitesRequest{})
	if err != nil {
		writeRPCError(w, err)
		return
	}

	sats := make([]map[string]any, 0, len(res.Satellites))
	for _, sat := range res.Satellites {
		sats = append(sats, map[string]any{
			"key":         sat.Key,
			"name":        sat.Name,
			"norad_id":    sat.NoradId,
			"color":       sat.Color,
			"launch_year": sat.LaunchYear,
			"category":    sat.Category,
			"operator":    sat.Operator,
			"swath_km":    sat.SwathKm,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"satellites": sats,
		"default":    res.DefaultSatellite,
	})
}

func (h *OrbitHandlers) handleGetTLE(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	res, err := h.Orbit.GetTLE(ctx, &pb.GetTLERequest{
		Satellite: r.URL.Query().Get("satellite"),
	})
	if err != nil {
		writeRPCError(w, err)
		return
	}

	out := map[string]any{
		"satellite_key": res.SatelliteKey,
		"name":          res.Name,
		"norad_id":      res.NoradId,
		"tle_line1":     res.TleLine1,
		"tle_line2":     res.TleLine2,
		"epoch":         res.Epoch,
		"age_hours":     res.AgeHours,
		"source":        res.Source,
	}
	if op := res.OrbitalParams; op != nil {
		out["orbital_params"] = map[string]any{
			"inclination_deg":  op.InclinationDeg,
			"raan_deg":         op.RaanDeg,
			"eccentricity":     op.Eccentricity,
			"arg_perigee_deg":  op.ArgPerigeeDeg,
			"mean_anomaly_deg": op.MeanAnomalyDeg,
			"mean_motion":      op.MeanMotion,
			"orbit_number":     op.OrbitNumber,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *OrbitHandlers) handleCurrentPosition(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	req := &pb.GetCurrentPositionRequest{Satellite: r.URL.Query().Get("satellite")}
	if at := r.URL.Query().Get("at"); at != "" {
		req.At = &at
	}

	res, err := h.Orbit.GetCurrentPosition(ctx, req)
	if err != nil {
		writeRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"latitude":       res.Latitude,
		"longitude":      res.Longitude,
		"altitude_km":    res.AltitudeKm,
		"velocity_km_s":  res.VelocityKmS,
		"orbit_number":   res.OrbitNumber,
		"satellite_key":  res.SatelliteKey,
		"satellite_name": res.SatelliteName,
		"color":          res.Color,
		"timestamp":      res.Timestamp,
	})
}

func (h *OrbitHandlers) handleTrack(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	q := r.URL.Query()
	req := &pb.GetTrackRequest{
		Satellite: q.Get("satellite"),
		Start:     q.Get("start"),
		End:       q.Get("end"),
	}

	if dur, err := strconv.Atoi(q.Get("duration_minutes")); err == nil && dur > 0 {
		req.DurationMinutes = int32(dur)
	} else if dur, err := strconv.Atoi(q.Get("duration")); err == nil && dur > 0 {
		req.DurationMinutes = int32(dur)
	}
	if step, err := strconv.Atoi(q.Get("step")); err == nil && step > 0 {
		req.StepSeconds = int32(step)
	}

	res, err := h.Orbit.GetTrack(ctx, req)
	if err != nil {
		writeRPCError(w, err)
		return
	}

	positions := make([]map[string]any, 0, len(res.Positions))
	for _, p := range res.Positions {
		positions = append(positions, map[string]any{
			"lat":  p.Lat,
			"lon":  p.Lon,
			"alt":  p.Alt,
			"time": p.Time,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"positions":    positions,
		"step_seconds": res.StepSeconds,
		"total_points": res.TotalPoints,
		"start":        res.Start,
		"end":          res.End,
	})
}

func (h *OrbitHandlers) handleOrbitInfo(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	res, err := h.Orbit.GetOrbitInfo(ctx, &pb.GetOrbitInfoRequest{
		Satellite: r.URL.Query().Get("satellite"),
	})
	if err != nil {
		writeRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"inclination_deg":      res.InclinationDeg,
		"eccentricity":         res.Eccentricity,
		"mean_motion_rev_day":  res.MeanMotionRevDay,
		"period_minutes":       res.PeriodMinutes,
		"altitude_km":          res.AltitudeKm,
		"tle_epoch":            res.TleEpoch,
		"tle_age_hours":        res.TleAgeHours,
		"current_orbit_number": res.CurrentOrbitNumber,
		"satellite_key":        res.SatelliteKey,
		"satellite_name":       res.SatelliteName,
		"color":                res.Color,
		"swath_km":             res.SwathKm,
		"tle_source":           res.TleSource,
	})
}

func (h *OrbitHandlers) handleSwath(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	req := &pb.GetSwathRequest{Satellite: r.URL.Query().Get("satellite")}
	if rad, err := strconv.ParseFloat(r.URL.Query().Get("radius"), 64); err == nil && rad > 0 {
		req.RadiusKm = rad
	}

	res, err := h.Orbit.GetSwath(ctx, req)
	if err != nil {
		writeRPCError(w, err)
		return
	}

	poly := make([][]float64, len(res.Polygon))
	for i, p := range res.Polygon {
		poly[i] = []float64{p.Lon, p.Lat}
	}

	var center any
	if res.Center != nil {
		center = map[string]float64{"lat": res.Center.Lat, "lon": res.Center.Lon}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"center":    center,
		"radius_km": res.RadiusKm,
		"polygon":   poly,
		"timestamp": res.Timestamp,
	})
}

func (h *OrbitHandlers) handlePolarCrossings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	req := &pb.GetPolarCrossingsRequest{Satellite: r.URL.Query().Get("satellite")}
	if hrs, err := strconv.Atoi(r.URL.Query().Get("hours")); err == nil && hrs > 0 {
		req.Hours = int32(hrs)
	}

	res, err := h.Orbit.GetPolarCrossings(ctx, req)
	if err != nil {
		writeRPCError(w, err)
		return
	}

	mapCrossings := func(xs []*pb.Crossing) []map[string]any {
		out := make([]map[string]any, 0, len(xs))
		for _, c := range xs {
			out = append(out, map[string]any{
				"time":      c.Time,
				"longitude": c.Longitude,
			})
		}
		return out
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ascending_nodes":  mapCrossings(res.AscendingNodes),
		"descending_nodes": mapCrossings(res.DescendingNodes),
		"note":             "Equator (node) crossings, not polar passages",
	})
}

func (h *OrbitHandlers) handleCoverageHeatmap(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	q := r.URL.Query()
	req := &pb.GetCoverageHeatmapRequest{Satellite: q.Get("satellite")}
	if hrs, err := strconv.Atoi(q.Get("hours")); err == nil && hrs > 0 {
		req.Hours = int32(hrs)
	}
	if g, err := strconv.Atoi(q.Get("grid")); err == nil && g > 0 {
		req.GridSize = int32(g)
	} else if g, err := strconv.Atoi(q.Get("grid_size")); err == nil && g > 0 {
		req.GridSize = int32(g)
	}

	res, err := h.Orbit.GetCoverageHeatmap(ctx, req)
	if err != nil {
		writeRPCError(w, err)
		return
	}

	cells := make([]map[string]any, 0, len(res.Cells))
	for _, c := range res.Cells {
		cells = append(cells, map[string]any{
			"lat":    c.Lat,
			"lon":    c.Lon,
			"passes": c.Passes,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"grid_size":  res.GridSize,
		"hours":      res.Hours,
		"satellite":  res.Satellite,
		"swath_km":   res.SwathKm,
		"max_passes": res.MaxPasses,
		"cell_count": res.CellCount,
		"cells":      cells,
	})
}

func (h *OrbitHandlers) handleConstellationCurrent(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	list, err := h.Orbit.ListSatellites(ctx, &pb.ListSatellitesRequest{})
	if err != nil {
		writeRPCError(w, err)
		return
	}

	results := make([]map[string]any, 0, len(list.Satellites))
	var firstErr error
	for _, sat := range list.Satellites {
		pos, err := h.Orbit.GetCurrentPosition(ctx, &pb.GetCurrentPositionRequest{
			Satellite: sat.Key,
		})
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			log.Printf("constellation: skip %s: %v", sat.Key, err)
			continue
		}
		results = append(results, map[string]any{
			"satellite_key":  pos.SatelliteKey,
			"satellite_name": pos.SatelliteName,
			"color":          pos.Color,
			"latitude":       pos.Latitude,
			"longitude":      pos.Longitude,
			"altitude_km":    pos.AltitudeKm,
			"velocity_km_s":  pos.VelocityKmS,
			"orbit_number":   pos.OrbitNumber,
			"timestamp":      pos.Timestamp,
			"swath_km":       sat.SwathKm,
			"category":       sat.Category,
		})
	}

	if len(results) == 0 && firstErr != nil {
		writeRPCError(w, firstErr)
		return
	}
	if len(results) == 0 {
		writeRPCError(w, errors.New("no constellation positions available"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"satellites": results,
		"count":      len(results),
	})
}

func (h *OrbitHandlers) handleFires(w http.ResponseWriter, r *http.Request) {
	// FIRMS upstream can be slow
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	q := r.URL.Query()
	req := &pb.GetFiresRequest{Satellite: q.Get("satellite")}
	if hrs, err := strconv.Atoi(q.Get("hours")); err == nil && hrs > 0 {
		req.Hours = int32(hrs)
	}

	res, err := h.Orbit.GetFires(ctx, req)
	if err != nil {
		// Transport failure: still return Flask-compatible empty body
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": err.Error(),
			"fires": []any{},
			"count": 0,
		})
		return
	}

	fires := make([]map[string]any, 0, len(res.Fires))
	for _, f := range res.Fires {
		fires = append(fires, map[string]any{
			"lat":        f.Lat,
			"lon":        f.Lon,
			"brightness": f.Brightness,
			"confidence": f.Confidence,
			"frp":        f.Frp,
			"acq_date":   f.AcqDate,
			"acq_time":   f.AcqTime,
			"daynight":   f.Daynight,
		})
	}

	statusCode := http.StatusOK
	out := map[string]any{
		"fires":     fires,
		"count":     res.Count,
		"source":    res.Source,
		"day_range": res.DayRange,
		"cached":    res.Cached,
	}
	if res.Error != "" {
		out["error"] = res.Error
		// Match Flask: empty fires with upstream error still returns a body;
		// use 502 when no points so clients can distinguish hard upstream failure.
		if res.Count == 0 {
			statusCode = http.StatusBadGateway
		}
	}
	writeJSON(w, statusCode, out)
}

// RegisterAstroProxies mounts SIMBAD + HiPS on a mux (orbit and nightsky ports).
func RegisterAstroProxies(mux *http.ServeMux, h *OrbitHandlers) {
	mux.HandleFunc("/api/simbad/region", h.handleSimbadRegion)
	mux.HandleFunc("/api/simbad/resolve", h.handleSimbadResolve)
	mux.HandleFunc("/api/surveys", h.handleSurveys)
	mux.HandleFunc("/api/cutout", h.handleCutout)
	mux.HandleFunc("/api/cutout/multi", h.handleCutoutMulti)
}

func writeJsonBlob(w http.ResponseWriter, res *pb.JsonBlob, err error) {
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": err.Error(),
		})
		return
	}
	code := int(res.StatusCode)
	if code == 0 {
		code = http.StatusOK
	}
	body := res.Json
	if body == "" {
		body = "{}"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(body))
	if body[len(body)-1] != '\n' {
		_, _ = w.Write([]byte("\n"))
	}
}

func (h *OrbitHandlers) handleSimbadRegion(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	q := r.URL.Query()
	ra, err1 := strconv.ParseFloat(q.Get("ra"), 64)
	dec, err2 := strconv.ParseFloat(q.Get("dec"), 64)
	if err1 != nil || err2 != nil || q.Get("ra") == "" || q.Get("dec") == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":   "ra and dec parameters required",
			"objects": []any{},
		})
		return
	}
	req := &pb.SimbadRegionRequest{Ra: ra, Dec: dec}
	if v, err := strconv.ParseFloat(q.Get("radius"), 64); err == nil && v > 0 {
		req.Radius = v
	}
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v > 0 {
		req.Limit = int32(v)
	}
	res, err := h.Orbit.SimbadRegion(ctx, req)
	writeJsonBlob(w, res, err)
}

func (h *OrbitHandlers) handleSimbadResolve(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	name := r.URL.Query().Get("name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "name parameter required",
			"found": false,
		})
		return
	}
	res, err := h.Orbit.SimbadResolve(ctx, &pb.SimbadResolveRequest{Name: name})
	writeJsonBlob(w, res, err)
}

func (h *OrbitHandlers) handleSurveys(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	res, err := h.Orbit.ListSurveys(ctx, &pb.ListSurveysRequest{})
	writeJsonBlob(w, res, err)
}

func (h *OrbitHandlers) handleCutout(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	q := r.URL.Query()
	ra, err1 := strconv.ParseFloat(q.Get("ra"), 64)
	dec, err2 := strconv.ParseFloat(q.Get("dec"), 64)
	if err1 != nil || err2 != nil || q.Get("ra") == "" || q.Get("dec") == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ra and dec parameters required"})
		return
	}
	req := &pb.GetCutoutRequest{Ra: ra, Dec: dec, Survey: q.Get("survey"), Format: q.Get("format")}
	if v, err := strconv.ParseFloat(q.Get("fov"), 64); err == nil && v > 0 {
		req.Fov = v
	}
	if v, err := strconv.Atoi(q.Get("width")); err == nil && v > 0 {
		req.Width = int32(v)
	}
	if v, err := strconv.Atoi(q.Get("height")); err == nil && v > 0 {
		req.Height = int32(v)
	}
	res, err := h.Orbit.GetCutout(ctx, req)
	writeJsonBlob(w, res, err)
}

func (h *OrbitHandlers) handleCutoutMulti(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	q := r.URL.Query()
	ra, err1 := strconv.ParseFloat(q.Get("ra"), 64)
	dec, err2 := strconv.ParseFloat(q.Get("dec"), 64)
	if err1 != nil || err2 != nil || q.Get("ra") == "" || q.Get("dec") == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ra and dec parameters required"})
		return
	}
	req := &pb.GetCutoutMultiRequest{Ra: ra, Dec: dec, Surveys: q.Get("surveys")}
	if v, err := strconv.ParseFloat(q.Get("fov"), 64); err == nil && v > 0 {
		req.Fov = v
	}
	res, err := h.Orbit.GetCutoutMulti(ctx, req)
	writeJsonBlob(w, res, err)
}

func (h *OrbitHandlers) handleSitePasses(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	q := r.URL.Query()
	lat, err1 := strconv.ParseFloat(q.Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(q.Get("lon"), 64)
	if err1 != nil || err2 != nil || q.Get("lat") == "" || q.Get("lon") == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "lat and lon parameters required",
			"passes": []any{},
		})
		return
	}
	req := &pb.GetSitePassesRequest{
		Satellite: q.Get("satellite"),
		Lat:       lat,
		Lon:       lon,
	}
	if v, err := strconv.ParseFloat(q.Get("hours"), 64); err == nil && v > 0 {
		req.Hours = v
	}
	if v, err := strconv.ParseFloat(q.Get("min_elevation"), 64); err == nil && v > 0 {
		req.MinElevationDeg = v
	}
	if v, err := strconv.ParseFloat(q.Get("site_alt_km"), 64); err == nil {
		req.SiteAltKm = v
	}
	if v, err := strconv.Atoi(q.Get("step")); err == nil && v > 0 {
		req.StepSeconds = int32(v)
	}
	if start := q.Get("start"); start != "" {
		req.Start = &start
	}
	res, err := h.Orbit.GetSitePasses(ctx, req)
	if err != nil {
		writeRPCError(w, err)
		return
	}
	passes := make([]map[string]any, 0, len(res.Passes))
	for _, p := range res.Passes {
		item := map[string]any{
			"aos":                          p.Aos,
			"los":                          p.Los,
			"max_elevation":                p.MaxElevation,
			"max_elevation_time":           p.MaxElevationTime,
			"duration_seconds":             p.DurationSeconds,
			"duration_minutes":             p.DurationMinutes,
			"site_daylight_at_max":         p.SiteDaylightAtMax,
			"site_solar_elevation_at_max":  p.SiteSolarElevationAtMax,
			"visual_pass_candidate":        p.VisualPassCandidate,
		}
		if p.SatSunlitAtMax != nil {
			item["sat_sunlit_at_max"] = *p.SatSunlitAtMax
		}
		passes = append(passes, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"satellite":          res.Satellite,
		"lat":                res.Lat,
		"lon":                res.Lon,
		"min_elevation_deg":  res.MinElevationDeg,
		"window_start":       res.WindowStart,
		"window_end":         res.WindowEnd,
		"passes":             passes,
		"count":              res.Count,
	})
}
