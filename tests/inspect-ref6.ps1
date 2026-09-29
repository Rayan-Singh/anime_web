$c = Get-Content "$env:TEMP\multinime_watch.html" -Raw
$i = $c.IndexOf('ep-nav-controls')
$start = [Math]::Max(0, $i - 100)
$len = [Math]::Min(8000, $c.Length - $start)
Write-Output $c.Substring($start, $len)
