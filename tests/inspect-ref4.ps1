$c = Get-Content "$env:TEMP\multinime_watch.html" -Raw
# Find server-related markup
foreach ($pattern in @('server', 'Server', 'sub', 'dub', 'quality', 'Quality', 'episode', 'player', 'Player', 'speed', 'Speed', 'theater', 'Theater', 'fullscreen', 'Fullscreen', 'pip', 'PiP', 'intro', 'Intro', 'outro', 'Outro', 'skip', 'Skip', 'next', 'Next', 'prev', 'Prev', 'auto', 'Auto')) {
    $i = $c.IndexOf($pattern)
    if ($i -ge 0) {
        $start = [Math]::Max(0, $i - 100)
        $len = [Math]::Min(400, $c.Length - $start)
        Write-Output "### $pattern"
        Write-Output $c.Substring($start, $len)
        Write-Output '-----'
    }
}
