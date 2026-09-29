$c = Get-Content "$env:TEMP\multinime_search.html" -Raw
$m = [regex]::Matches($c, '<select[^>]*>.*?</select>', 'Singleline')
foreach ($match in $m) { Write-Output $match.Value; Write-Output '-----' }
$m2 = [regex]::Matches($c, '<(form|input|button)[^>]*>', 'Singleline')
foreach ($match in $m2) { Write-Output $match.Value }
