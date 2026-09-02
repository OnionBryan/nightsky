// Package httpapi — HTTP handlers for the nightsky edge (port 5051).
package httpapi

import (
	"context"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	nspb "noaa21_orbit/api/proto/nightsky/v1"
	"noaa21_orbit/internal/clients"
)

// NightskyHandlers proxies /api/nightsky/* (and related) to the nightsky gRPC worker.
type NightskyHandlers struct {
	Client *clients.NightskyClient
}

func (h *NightskyHandlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/nightsky/health", h.health)
	mux.HandleFunc("/health", h.health)
	mux.HandleFunc("/api/nightsky/geocode", h.geocode)
	mux.HandleFunc("/api/nightsky/options", h.options)
	mux.HandleFunc("/api/nightsky/planets", h.planets)
	mux.HandleFunc("/api/nightsky/moon", h.moon)
	mux.HandleFunc("/api/nightsky/info", h.info)
	mux.HandleFunc("/api/nightsky/geostationary", h.geoVisible)
	mux.HandleFunc("/api/nightsky/geostationary/arc", h.geoArc)
	mux.HandleFunc("/api/nightsky/geostationary/lookup", h.geoLookup)
	mux.HandleFunc("/api/nightsky/geostationary/satellites", h.geoList)
	mux.HandleFunc("/api/nightsky/twilight", h.twilight)
	mux.HandleFunc("/api/nightsky/riseset", h.riseset)
	mux.HandleFunc("/api/nightsky/weather", h.weather)
	mux.HandleFunc("/api/nightsky/generate", h.generate)
	mux.HandleFunc("/api/aurora/kp", h.aurora)
	mux.HandleFunc("/api/lightpollution", h.lightPollution)
	mux.HandleFunc("/api/satellites/tle", h.satelliteTLE)
	mux.HandleFunc("/api/ephemeris", h.ephemeris)
	mux.HandleFunc("/api/nightsky/session", h.sessionGoNoGo)
	mux.HandleFunc("/api/nightsky/go-no-go", h.sessionGoNoGo)
}

func writeRawJSON(w http.ResponseWriter, status int, body string) {
	if body == "" {
		body = "{}"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
	if len(body) == 0 || body[len(body)-1] != '\n' {
		_, _ = w.Write([]byte("\n"))
	}
}

func (h *NightskyHandlers) emitJSON(w http.ResponseWriter, res *nspb.JsonResponse, err error) {
	if err != nil {
		log.Printf("nightsky RPC error: %v", err)
		writeRawJSON(w, http.StatusServiceUnavailable, `{"error":`+strconv.Quote(err.Error())+`}`)
		return
	}
	code := int(res.StatusCode)
	if code == 0 {
		code = http.StatusOK
	}
	writeRawJSON(w, code, res.Json)
}

func (h *NightskyHandlers) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	res, err := h.Client.Health(ctx, &nspb.HealthRequest{})
	if err != nil {
		writeRawJSON(w, http.StatusServiceUnavailable,
			`{"status":"degraded","service":"nightsky-edge","grpc":"down","error":`+strconv.Quote(err.Error())+`}`)
		return
	}
	writeRawJSON(w, http.StatusOK,
		`{"status":"`+res.Status+`","service":"nightsky-edge","grpc":"up","worker":"`+res.Service+`"}`)
}

func (h *NightskyHandlers) geocode(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	res, err := h.Client.Geocode(ctx, &nspb.GeocodeRequest{Q: r.URL.Query().Get("q")})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) options(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	res, err := h.Client.Options(ctx, &nspb.Empty{})
	h.emitJSON(w, res, err)
}

func latLon(r *http.Request) *nspb.LatLonRequest {
	lat, _ := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, _ := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	return &nspb.LatLonRequest{Lat: lat, Lon: lon}
}

func (h *NightskyHandlers) planets(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	res, err := h.Client.Planets(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) moon(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	res, err := h.Client.Moon(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) info(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	res, err := h.Client.LocationInfo(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) geoVisible(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	q := r.URL.Query()
	lat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	lon, _ := strconv.ParseFloat(q.Get("lon"), 64)
	minEl, _ := strconv.ParseFloat(q.Get("min_elevation"), 64)
	res, err := h.Client.GeostationaryVisible(ctx, &nspb.GeoVisibleRequest{
		Lat: lat, Lon: lon, Category: q.Get("category"), MinElevation: minEl,
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) geoArc(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	q := r.URL.Query()
	lat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	lon, _ := strconv.ParseFloat(q.Get("lon"), 64)
	pts, _ := strconv.Atoi(q.Get("points"))
	res, err := h.Client.GeostationaryArc(ctx, &nspb.GeoArcRequest{
		Lat: lat, Lon: lon, Points: int32(pts),
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) geoLookup(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := r.URL.Query()
	lat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	lon, _ := strconv.ParseFloat(q.Get("lon"), 64)
	satLon, _ := strconv.ParseFloat(q.Get("sat_lon"), 64)
	res, err := h.Client.GeostationaryLookup(ctx, &nspb.GeoLookupRequest{
		Lat: lat, Lon: lon, SatLon: satLon,
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) geoList(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	res, err := h.Client.GeostationaryList(ctx, &nspb.CategoryRequest{
		Category: r.URL.Query().Get("category"),
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) twilight(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := h.Client.Twilight(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) riseset(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	ll := latLon(r)
	res, err := h.Client.RiseSet(ctx, &nspb.RiseSetRequest{
		Lat: ll.Lat, Lon: ll.Lon, Object: r.URL.Query().Get("object"),
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) weather(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := h.Client.Weather(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) generate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodOptions {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeRawJSON(w, 400, `{"error":"failed to read body"}`)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	res, err := h.Client.GenerateSky(ctx, &nspb.GenerateSkyRequest{RequestJson: string(body)})
	if err != nil {
		writeRawJSON(w, 503, `{"error":`+strconv.Quote(err.Error())+`}`)
		return
	}
	if res.Error != "" || res.StatusCode >= 400 {
		code := int(res.StatusCode)
		if code == 0 {
			code = 500
		}
		msg := res.Error
		if msg == "" {
			msg = "generate failed"
		}
		writeRawJSON(w, code, `{"error":`+strconv.Quote(msg)+`}`)
		return
	}
	ctype := res.ContentType
	if ctype == "" {
		ctype = "image/png"
	}
	w.Header().Set("Content-Type", ctype)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(res.Data)
}

func (h *NightskyHandlers) aurora(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res, err := h.Client.AuroraKp(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) lightPollution(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res, err := h.Client.LightPollution(ctx, latLon(r))
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) satelliteTLE(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	q := r.URL.Query()
	res, err := h.Client.SatelliteTLE(ctx, &nspb.SatelliteTLERequest{
		Group:   q.Get("group"),
		NoradId: q.Get("norad_id"),
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) ephemeris(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	q := r.URL.Query()
	lat, _ := strconv.ParseFloat(q.Get("lat"), 64)
	lon, _ := strconv.ParseFloat(q.Get("lon"), 64)
	name := q.Get("name")
	if name == "" {
		name = q.Get("object")
	}
	res, err := h.Client.Ephemeris(ctx, &nspb.EphemerisRequest{
		Name: name, Lat: lat, Lon: lon,
	})
	h.emitJSON(w, res, err)
}

func (h *NightskyHandlers) sessionGoNoGo(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	ll := latLon(r)
	res, err := h.Client.SessionGoNoGo(ctx, &nspb.SessionGoNoGoRequest{
		Lat: ll.Lat, Lon: ll.Lon,
	})
	h.emitJSON(w, res, err)
}
