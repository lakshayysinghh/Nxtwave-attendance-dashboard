// Package migrations embeds the golang-migrate SQL files so the server
// binary can apply them without the files on disk.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
