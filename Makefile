# .PHONY because the test directory would otherwise count as this target
# already being up to date.
.PHONY: install lint test

WEB := herdr-project-web
# npm writes this last, so a failed install is tried again.
DEPS := $(WEB)/node_modules/.package-lock.json

lint: $(DEPS)
	uv run ruff check .
	npm --prefix $(WEB) run check

test: $(DEPS)
	uv run python -m pytest test busywork -v
	npm --prefix $(WEB) test

# Installed again only when the lock file changes.
$(DEPS): $(WEB)/package-lock.json
	npm --prefix $(WEB) ci

install:
	./install.sh
