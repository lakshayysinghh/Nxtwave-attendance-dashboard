# Root tasks. Needs GNU make, Docker, Go and Node.
# Windows: `winget install ezwinports.make`, then run from PowerShell or Git Bash.
.PHONY: dev dev-api dev-web db-up db-down test lint migrate-up migrate-down sqlc

## dev: start Postgres, apply migrations, then run the API (:8080) and web (:3000) together
dev: db-up migrate-up web/node_modules/.package-lock.json
	$(MAKE) -j2 dev-api dev-web

dev-api:
	cd api && go run ./cmd/server

dev-web:
	cd web && npm run dev

web/node_modules/.package-lock.json: web/package-lock.json
	cd web && npm install

db-up:
	docker compose up -d --wait db

db-down:
	docker compose down

test: web/node_modules/.package-lock.json
	cd api && go vet ./... && go test ./...
	cd web && npm run typecheck

lint: web/node_modules/.package-lock.json
	cd api && golangci-lint run ./...
	cd web && npm run lint

migrate-up:
	cd api && go run ./cmd/server migrate up

## migrate-down: roll back the most recent migration only
migrate-down:
	cd api && go run ./cmd/server migrate down

sqlc:
	cd api && sqlc generate
