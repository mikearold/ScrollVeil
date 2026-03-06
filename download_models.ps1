[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$detectorDir = "C:\Users\Family\OneDrive\Desktop\Vibe Coding\SafeScroll\lib\blazepose-detector"
$landmarkDir = "C:\Users\Family\OneDrive\Desktop\Vibe Coding\SafeScroll\lib\blazepose-landmark-lite"

# Try kaggle/tfhub URLs for BlazePose detector model
$baseDetector = "https://www.kaggle.com/models/mediapipe/blazepose-3d/tfJs/detector/1"
$baseLandmark = "https://www.kaggle.com/models/mediapipe/blazepose-3d/tfJs/landmark-lite/2"

Write-Host "Downloading detector model.json..."
try {
    Invoke-WebRequest -Uri "$baseDetector/model.json?tfjs-format=file" -OutFile "$detectorDir\model.json" -UseBasicParsing
    Write-Host "SUCCESS: detector model.json downloaded"
} catch {
    Write-Host "FAILED detector: $($_.Exception.Message)"
}

Write-Host "Downloading landmark model.json..."
try {
    Invoke-WebRequest -Uri "$baseLandmark/model.json?tfjs-format=file" -OutFile "$landmarkDir\model.json" -UseBasicParsing
    Write-Host "SUCCESS: landmark model.json downloaded"
} catch {
    Write-Host "FAILED landmark: $($_.Exception.Message)"
}
