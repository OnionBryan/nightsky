# ============================================================
#  NOAA-21 Orbit & Night Sky Viewer - Makefile
# ============================================================

.PHONY: install run stop status clean help science edge-science edge-nightsky edge-go edge edge-start edge-stop edge-status edge-restart

PORTS := 5050 5051 8080 8081
EDGE_PORTS := 50051 50052 5050 5051

help: ## Show this help
	@echo ""
	@echo "  NOAA-21 Orbit & Night Sky Viewer"
	@echo "  ================================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-12s %s\n", $$1, $$2}'
	@echo ""

install: ## First-run setup (venv, deps, ephemeris)
	@bash install.sh

run: ## Start all 4 services
	@bash start.sh

stop: ## Kill all services on ports 5050, 5051, 8080, 8081
	@echo "Stopping services..."
	@for port in $(PORTS); do \
		pid=$$(lsof -ti :$$port 2>/dev/null); \
		if [ -n "$$pid" ]; then \
			echo "  Killing PID $$pid on port $$port"; \
			kill -9 $$pid 2>/dev/null || true; \
		fi; \
	done
	@echo "All services stopped."

status: ## Show which services are running
	@echo ""
	@echo "  Service Status"
	@echo "  =============="
	@for port in $(PORTS); do \
		pid=$$(lsof -ti :$$port 2>/dev/null); \
		if [ -n "$$pid" ]; then \
			case $$port in \
				5050) name="Orbit API       ";; \
				5051) name="Night Sky API   ";; \
				8080) name="Orbit Frontend  ";; \
				8081) name="Night Sky Front ";; \
			esac; \
			echo "  [RUNNING] $$name :$$port  (PID $$pid)"; \
		else \
			case $$port in \
				5050) name="Orbit API       ";; \
				5051) name="Night Sky API   ";; \
				8080) name="Orbit Frontend  ";; \
				8081) name="Night Sky Front ";; \
			esac; \
			echo "  [STOPPED] $$name :$$port"; \
		fi; \
	done
	@echo ""

science: ## Run science baseline regression tests (orbital + sky)
	@backend/venv/bin/python -m unittest tests.test_science_baseline -v

edge-science: ## Start Python orbit gRPC worker on :50051
	@backend/venv/bin/python -m backend.orbit_science.server

edge-nightsky: ## Start Python nightsky gRPC worker on :50052
	@backend/venv/bin/python -m backend.nightsky_science.server

edge-go: ## Start Go HTTP edge :5050 (orbit) + :5051 (nightsky)
	@go run ./cmd/server

edge-start: ## Supervised start: science workers + Go edge (one listener per port)
	@bash scripts/edge-stack.sh start

edge-stop: ## Stop supervised edge stack (ports 50051/50052/5050/5051)
	@bash scripts/edge-stack.sh stop

edge-status: ## Show edge stack listeners
	@bash scripts/edge-stack.sh status

edge-restart: ## Restart supervised edge stack
	@bash scripts/edge-stack.sh restart

edge: ## Print how to run the full gRPC edge stack
	@echo ""
	@echo "  Recommended (supervised, single-listener):"
	@echo "    make edge-start"
	@echo "    make edge-status"
	@echo "    make edge-stop"
	@echo ""
	@echo "  Manual (three terminals):"
	@echo "    make edge-science    # :50051"
	@echo "    make edge-nightsky   # :50052"
	@echo "    make edge-go         # :5050 + :5051"
	@echo ""
	@echo "  Probe:"
	@echo "    curl -s http://localhost:5050/api/health"
	@echo "    curl -s http://localhost:5051/api/nightsky/health"
	@echo "    curl -s 'http://localhost:5051/api/nightsky/moon?lat=40.7&lon=-74'"
	@echo ""

clean: ## Remove venv, caches, and compiled files
	@echo "Cleaning up..."
	@rm -rf venv
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "Cleaned: venv, __pycache__, *.pyc"
