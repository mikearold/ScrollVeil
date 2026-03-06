$b64Path = "C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil\icons\icon128.b64"
$outPath = "C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil\icons\icon128.png"
$b64 = Get-Content $b64Path -Raw
[System.IO.File]::WriteAllBytes($outPath, [Convert]::FromBase64String($b64.Trim()))
Write-Output "icon128.png written"

# Also copy to store_icon_128.png (same file)
$storePath = "C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil\icons\store_icon_128.png"
Copy-Item $outPath $storePath -Force
Write-Output "store_icon_128.png written"

# Cleanup
Remove-Item $b64Path
Write-Output "Done!"