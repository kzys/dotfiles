# .PHONY because the test directory would otherwise count as this target
# already being up to date.
.PHONY: test

# ./test, not test: given a bare name unittest falls back to importing the
# module of that name, finds the standard library's test package and passes
# having run that instead.
test:
	python3 -m unittest discover -s ./test -v
