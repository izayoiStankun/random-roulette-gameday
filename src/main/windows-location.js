const path = require("node:path");
const { execFile } = require("node:child_process");

const LOCATION_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Geolocation.Geolocator, Windows.Devices.Geolocation, ContentType=WindowsRuntime]
$locator = [Windows.Devices.Geolocation.Geolocator]::new()
$locator.DesiredAccuracyInMeters = 1000
$operation = $locator.GetGeopositionAsync([TimeSpan]::FromMinutes(10), [TimeSpan]::FromSeconds(15))
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
} | Select-Object -First 1
$task = $asTask.MakeGenericMethod([Windows.Devices.Geolocation.Geoposition]).Invoke($null, @($operation))
$task.Wait()
$position = $task.Result.Coordinate.Point.Position
[pscustomobject]@{ latitude = $position.Latitude; longitude = $position.Longitude } | ConvertTo-Json -Compress
`;

function parseLocationOutput(stdout) {
  const line = String(stdout || "").split(/\r?\n/).reverse().find((value) => value.trim().startsWith("{"));
  if (!line) throw new Error("Windows 위치 응답을 읽지 못했습니다.");
  const location = JSON.parse(line);
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Windows 위치 응답이 올바르지 않습니다.");
  }
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100
  };
}

function getWindowsLocation(execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("현재 위치 자동 확인은 Windows에서만 지원합니다."));
      return;
    }
    const windowsDirectory = process.env.SystemRoot || "C:\\Windows";
    const powershell = path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    execFileImpl(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", LOCATION_SCRIPT], {
      windowsHide: true,
      timeout: 25000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        reject(new Error("현재 위치를 확인하지 못했습니다. Windows 설정에서 위치 서비스를 켠 뒤 다시 시도해 주세요."));
        return;
      }
      try {
        resolve(parseLocationOutput(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

module.exports = { LOCATION_SCRIPT, getWindowsLocation, parseLocationOutput };
