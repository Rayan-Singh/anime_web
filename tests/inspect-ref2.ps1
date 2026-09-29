$c = Get-Content "$env:TEMP\multinime_search.html" -Raw
$i = $c.IndexOf('filter')
$count = 0
while ($i -ge 0 -and $count -lt 8) {
    $start = [Math]::Max(0, $i - 300)
    $len = [Math]::Min(700, $c.Length - $start)
    Write-Output $c.Substring($start, $len)
    Write-Output '====='
    $i = $c.IndexOf('filter', $i + 1)
    $count++
}
