# ============================================================
#  NOAA-21 Orbit & Night Sky Viewer - Makefile
# ============================================================

.PHONY: install run stop status clean help

PORTS := 5050 5051 8080 8081

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

clean: ## Remove venv, caches, and compiled files
	@echo "Cleaning up..."
	@rm -rf venv
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "Cleaned: venv, __pycache__, *.pyc"
