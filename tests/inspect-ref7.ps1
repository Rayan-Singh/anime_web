$c = Get-Content "$env:TEMP\multinime_anime.html" -Raw
# Find the main content area
$i = $c.IndexOf('main-content')
if ($i -lt 0) { $i = $c.IndexOf('<main') }
$start = [Math]::Max(0, $i)
$len = [Math]::Min(9000, $c.Length - $start)
Write-Output $c.Substring($start, $len)
