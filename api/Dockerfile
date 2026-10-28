# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/server /server
ENV APP_ENV=production TZ=Asia/Kolkata
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
