$c = Get-Content "$env:TEMP\multinime_watch.html" -Raw
$i = $c.IndexOf('player-control-bar')
$start = [Math]::Max(0, $i - 200)
$len = [Math]::Min(6000, $c.Length - $start)
Write-Output $c.Substring($start, $len)
