# .PHONY because the test directory would otherwise count as this target
# already being up to date.
.PHONY: install test

test:
	uv run --with pytest --with pyyaml python -m pytest test busywork -v

install:
	./install.sh
