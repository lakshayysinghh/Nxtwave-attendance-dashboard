# API tasks. Run from api/ or via the root Makefile.
.PHONY: run build test vet lint sqlc migrate-up migrate-down

run:
	go run ./cmd/server

build:
	go build -o bin/server ./cmd/server

test:
	go test ./...

vet:
	go vet ./...

lint:
	golangci-lint run ./...

sqlc:
	sqlc generate

migrate-up:
	go run ./cmd/server migrate up

migrate-down:
	go run ./cmd/server migrate down
