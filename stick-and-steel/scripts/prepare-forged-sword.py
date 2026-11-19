"""Repair and package cmtvnboe9001y2poagte9orpv; original and previous sword stay intact."""
import json, struct
from pathlib import Path
import numpy as np
source = Path('assets/a-single-elegant-medieval-arming-sword-f-cmtvnboe.glb')
data = source.read_bytes(); size = struct.unpack_from('<I', data, 12)[0]
j = json.loads(data[20:20+size]); binary = bytearray(data[28+size:])
primitive = j['meshes'][0]['primitives'][0]
accessor = j['accessors'][primitive['attributes']['POSITION']]
view = j['bufferViews'][accessor['bufferView']]
pos = np.frombuffer(binary, np.float32, count=accessor['count']*3, offset=view.get('byteOffset', 0)+accessor.get('byteOffset', 0)).reshape(-1, 3)
# The generated blade leans in X and its hilt is a quarter turn out of plane.
# Centre each measured section smoothly, preserving the generated bevels/fullers.
y_original = pos[:, 1].copy()
centres=[]
for y in np.linspace(-.45,.465,40):
 mask=np.abs(y_original-y)<.012
 if mask.any(): centres.append((y,(float(pos[mask,0].min())+float(pos[mask,0].max()))/2))
ys,xs=np.array(centres).T
pos[:,0]-=np.interp(y_original,ys,xs)
pos[:,2]-=.0002
blend=np.clip((y_original+.31)/.06,0,1); blend=blend*blend*(3-2*blend)
angle=(1-blend)*np.pi/2
x,z=pos[:,0].copy(),pos[:,2].copy()
pos[:,0]=x*np.cos(angle)+z*np.sin(angle);pos[:,2]=-x*np.sin(angle)+z*np.cos(angle)
guard=-.285
# Match blade length and grip positions, without pinching the blade base.
pos[:,1]=np.interp(y_original,[float(y_original.min()),guard,float(y_original.max())],[-.47,-.22,.49])
pos[:,0]*=.25/np.ptp(pos[:,0])
blade=pos[:,1]>-.19
pos[blade,0]*=.070/np.ptp(pos[blade,0])
# A thin edge, but a full hand-sized grip: continuous depth transition at the guard.
transition=np.clip((pos[:,1]+.23)/.05,0,1)
depth_scale=(1-transition)*(.048/np.ptp(pos[~blade,2]))+transition*(.012/np.ptp(pos[blade,2]))
pos[:,2]*=depth_scale
accessor['min']=pos.min(0).tolist();accessor['max']=pos.max(0).tolist()
# Keep genuine geometry detail. Clean metals avoid painted reflections and noisy normals.
j['materials']=[
 {'name':'Satin forged steel','pbrMetallicRoughness':{'baseColorFactor':[.30,.34,.38,1],'metallicFactor':.86,'roughnessFactor':.38}},
 {'name':'Muted brass fittings','pbrMetallicRoughness':{'baseColorFactor':[.30,.19,.07,1],'metallicFactor':.78,'roughnessFactor':.4}},
 {'name':'Charcoal leather wrap','pbrMetallicRoughness':{'baseColorFactor':[.035,.029,.025,1],'metallicFactor':.02,'roughnessFactor':.83}},
]
ia=j['accessors'][primitive['indices']];iv=j['bufferViews'][ia['bufferView']]
dtype={5123:np.uint16,5125:np.uint32}[ia['componentType']]
indices=np.frombuffer(binary,dtype,count=ia['count'],offset=iv.get('byteOffset',0)+ia.get('byteOffset',0)).copy().reshape(-1,3)
centroid=pos[indices,1].mean(1)
regions=np.where(centroid>-.19,0,np.where((centroid<-.272)&(centroid>-.422),2,1))
# Strip unused generated image buffers from the runtime package; the source preserves them.
image_views={image['bufferView'] for image in j.get('images',[])}
for v in image_views:j['bufferViews'][v]['_replacement']=b''
j.pop('images',None);j.pop('textures',None);j.pop('samplers',None)
old=bytes(binary);binary=bytearray()
for v in j['bufferViews']:
 chunk=v.pop('_replacement',old[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])
 # Keep valid nonzero buffer views even when their now-unused images were removed.
 if not chunk:chunk=b'\0\0\0\0'
 binary.extend(b'\0'*(-len(binary)%4));v['byteOffset']=len(binary);v['byteLength']=len(chunk);binary.extend(chunk)
primitives=[]
for material in range(3):
 selected=indices[regions==material].flatten();binary.extend(b'\0'*(-len(binary)%4));offset=len(binary);chunk=selected.tobytes();binary.extend(chunk)
 j['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(chunk),'target':34963})
 j['accessors'].append({'bufferView':len(j['bufferViews'])-1,'componentType':ia['componentType'],'count':len(selected),'type':'SCALAR','min':[int(selected.min())],'max':[int(selected.max())]})
 attributes={k:v for k,v in primitive['attributes'].items() if k not in ['NORMAL','TANGENT']}
 primitives.append({'attributes':attributes,'indices':len(j['accessors'])-1,'material':material,'mode':4})
j['meshes'][0]['primitives']=primitives
binary.extend(b'\0'*(-len(binary)%4));j['buffers'][0]['byteLength']=len(binary)
encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
out=Path('public/assets/sword-forged-cmtvnboe9001y2poagte9orpv.glb');out.write_bytes(result)
print(out,len(result)//1024,'KB',len(indices),'triangles','bounds',pos.min(0),pos.max(0))
