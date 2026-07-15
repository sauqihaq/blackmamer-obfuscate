package main

import (
    "bufio"
    "fmt"
    "io"
    "os"
    "os/exec"
    "path/filepath"
)

func main() {
    // Baca input dari stdin
    reader := bufio.NewReader(os.Stdin)
    code, err := io.ReadAll(reader)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error reading input: %v\n", err)
        os.Exit(1)
    }

    // Buat file temporary
    tmpFile, err := os.CreateTemp("", "script_*.lua")
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error creating temp file: %v\n", err)
        os.Exit(1)
    }
    defer os.Remove(tmpFile.Name())

    // Tulis kode ke file
    if _, err := tmpFile.Write(code); err != nil {
        fmt.Fprintf(os.Stderr, "Error writing temp file: %v\n", err)
        os.Exit(1)
    }
    tmpFile.Close()

    // Cari binary Prometheus
    prometheusPath := "./prometheus"
    if _, err := os.Stat(prometheusPath); os.IsNotExist(err) {
        // Coba di path lain
        prometheusPath = "prometheus"
    }

    // Jalankan Prometheus
    cmd := exec.Command(prometheusPath, "-file", tmpFile.Name(), "-obfuscate")
    output, err := cmd.Output()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error running Prometheus: %v\n", err)
        os.Exit(1)
    }

    // Output hasil obfuscate
    fmt.Print(string(output))
}
