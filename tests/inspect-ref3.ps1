$lines = Get-Content "$env:TEMP\multinime_app.js"
foreach ($line in $lines) {
    if ($line -match 'genre|type|year|season|status|sort|filter|option') {
        Write-Output ($line.Trim())
    }
}
