/**Alert the user that they have to give permission to us for location */
alert("📍 Location Permission Required\n\nGeoAttend uses your GPS to verify onsite attendance. Your location is only recorded at sign-in and sign-out — never tracked in the background.\n\n⏱  Onsite window: 08:00 – 08:30 sign-in\n🔒  Sign-out deadline: 15:00\n📌  One-time read only at each action");

function updateDateTime() {
    const now = new Date();
    const options = { timeZone: "Africa/Johannesburg" };

    const time = now.toLocaleTimeString("en-ZA", { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const date = now.toLocaleDateString("en-ZA", { ...options, weekday: "long", day: "numeric", month: "long", year: "numeric" });

    document.getElementById("clock").textContent = time;
    document.getElementById("date").textContent = date;
}

setInterval(updateDateTime, 1000);
updateDateTime();

// SpecCon reference point (your coordinates)
const SPECCON_LAT = -25.82731638243808;
const SPECCON_LNG = 28.2034515438192;
const ALLOWED_RADIUS_M = 50

;
/**This is going to be the main logic for attendance and us comparing it to SpecCon Co-ordinates */
function SignIn(){
/**-25.82720921421218, 28.203470557671697 */
}

function SignOut(){
    
}