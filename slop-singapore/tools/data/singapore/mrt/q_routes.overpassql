[out:json][timeout:300];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(relation["type"="route"]["route"~"^(subway|light_rail|monorail)$"](area.sg););
out body;
>;
out body geom qt;
