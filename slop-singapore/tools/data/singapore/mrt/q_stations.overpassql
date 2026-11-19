[out:json][timeout:300];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(nwr["railway"="station"](area.sg);nwr["public_transport"="station"](area.sg);relation["public_transport"="stop_area"](area.sg);node["railway"="subway_entrance"](area.sg););
out body center;
