// Dual edge server: HTTP/JSON frontends → gRPC science workers.
//
//	go run ./cmd/server
//
// Orbit  HTTP :5050 → gRPC :50051 (orbit_science)
// Nightsky HTTP :5051 → gRPC :50052 (nightsky_science)
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"noaa21_orbit/internal/clients"
	"noaa21_orbit/internal/httpapi"
)

const (
	defaultOrbitHTTPAddr    = ":5050"
	defaultOrbitGRPCAddr    = "localhost:50051"
	defaultNightskyHTTPAddr = ":5051"
	defaultNightskyGRPCAddr = "localhost:50052"
)

func main() {
	orbitGRPC := envOr("ORBIT_GRPC_ADDR", defaultOrbitGRPCAddr)
	orbitHTTP := envOr("ORBIT_HTTP_ADDR", defaultOrbitHTTPAddr)
	nsGRPC := envOr("NIGHTSKY_GRPC_ADDR", defaultNightskyGRPCAddr)
	nsHTTP := envOr("NIGHTSKY_HTTP_ADDR", defaultNightskyHTTPAddr)

	orbit, err := clients.NewOrbitClient(orbitGRPC)
	if err != nil {
		log.Fatalf("orbit gRPC dial %s: %v", orbitGRPC, err)
	}
	defer orbit.Close()

	nightsky, err := clients.NewNightskyClient(nsGRPC)
	if err != nil {
		log.Fatalf("nightsky gRPC dial %s: %v", nsGRPC, err)
	}
	defer nightsky.Close()

	orbitHandlers := &httpapi.OrbitHandlers{Orbit: orbit}
	orbitMux := http.NewServeMux()
	orbitHandlers.Register(orbitMux)
	// Orbit UI + data on :5050 (same origin as orbit API)
	mountStatic(orbitMux, envOr("ORBIT_STATIC_DIR", ""), []string{
		"frontend",
		filepath.Join(".", "frontend"),
	}, "orbit frontend")

	nsHandlers := &httpapi.NightskyHandlers{Client: nightsky}
	nsMux := http.NewServeMux()
	nsHandlers.Register(nsMux)
	// Telescope UI on :5051 also needs SIMBAD / HiPS
	httpapi.RegisterAstroProxies(nsMux, orbitHandlers)
	// Night Sky Viewer + data/*.json (lore catalog) on :5051 — same origin as nightsky API
	// Prefer NIGHTSKY_STATIC_DIR; otherwise resolve nightsky/frontend from cwd / exec dir.
	mountStatic(nsMux, envOr("NIGHTSKY_STATIC_DIR", ""), []string{
		filepath.Join("nightsky", "frontend"),
		filepath.Join(".", "nightsky", "frontend"),
	}, "nightsky frontend")

	go func() {
		log.Printf("Nightsky edge listening on %s → gRPC %s (UI + /data/* + /api/*)", nsHTTP, nsGRPC)
		if err := http.ListenAndServe(nsHTTP, httpapi.CorsMiddleware(nsMux)); err != nil {
			log.Fatalf("nightsky HTTP serve: %v", err)
		}
	}()

	log.Printf("Orbit edge listening on %s → gRPC %s (UI + /api/*)", orbitHTTP, orbitGRPC)
	if err := http.ListenAndServe(orbitHTTP, httpapi.CorsMiddleware(orbitMux)); err != nil {
		log.Fatalf("orbit HTTP serve: %v", err)
	}
}

// mountStatic registers a FileServer at "/" for the first existing directory.
// API routes registered before this still take precedence (more specific patterns).
// envDir, if non-empty, is tried first (absolute or relative).
func mountStatic(mux *http.ServeMux, envDir string, candidates []string, label string) {
	var tried []string
	try := func(dir string) bool {
		if dir == "" {
			return false
		}
		abs, err := filepath.Abs(dir)
		if err != nil {
			tried = append(tried, dir+" (abs err)")
			return false
		}
		tried = append(tried, abs)
		st, err := os.Stat(abs)
		if err != nil || !st.IsDir() {
			return false
		}
		// Verify lore / index assets when mounting nightsky (best-effort)
		fs := http.FileServer(http.Dir(abs))
		mux.Handle("/", fs)
		log.Printf("static %s: %s", label, abs)
		return true
	}

	if try(envDir) {
		return
	}
	// Also try next to the executable (when cwd is wrong)
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		for _, c := range candidates {
			if try(filepath.Join(exeDir, c)) {
				return
			}
			// repo-root layout: bin in .edge-logs/ → ../nightsky/frontend
			if try(filepath.Join(exeDir, "..", c)) {
				return
			}
		}
	}
	for _, c := range candidates {
		if try(c) {
			return
		}
	}
	log.Printf("static %s: SKIPPED — none of: %v", label, tried)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
