"""Package the blackened arming sword; keep both earlier swords and all originals."""
import io, json, struct
from pathlib import Path
import numpy as np
from PIL import Image
source=Path('assets/dark-medieval-one-handed-arming-sword-pr-cmtvomjc.glb')
data=source.read_bytes();size=struct.unpack_from('<I',data,12)[0]
g=json.loads(data[20:20+size]);binary=bytearray(data[28+size:])
primitive=g['meshes'][0]['primitives'][0];a=g['accessors'][primitive['attributes']['POSITION']];view=g['bufferViews'][a['bufferView']]
pos=np.frombuffer(binary,np.float32,a['count']*3,view.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,3)
# The actual source has its tip down (-Y), with the wide blade along Z.
# A half-turn about Z followed by a quarter-turn about Y sets +Y tip / X edge.
x,y,z=pos[:,0].copy(),pos[:,1].copy(),pos[:,2].copy()
pos[:,0]=z;pos[:,1]=-y;pos[:,2]=x
pos[:,1]=np.interp(pos[:,1],[float(pos[:,1].min()),-.218,float(pos[:,1].max())],[-.47,-.22,.49])
pos[:,0]-=(pos[:,0].min()+pos[:,0].max())/2
pos[:,2]-=(pos[:,2].min()+pos[:,2].max())/2
pos[:,0]*=.25/np.ptp(pos[:,0]);pos[:,2]*=.046/np.ptp(pos[:,2])
a['min']=pos.min(0).tolist();a['max']=pos.max(0).tolist()
for mesh in g['meshes']:
 for p in mesh['primitives']:
  p['attributes'].pop('NORMAL',None);p['attributes'].pop('TANGENT',None)
# Preserve the generated blackened metal, worn bevels and dark oxblood wrap.
# 1K local maps suit a handheld weapon; the provider originals stay untouched.
for image in g['images']:
 v=g['bufferViews'][image['bufferView']]
 im=Image.open(io.BytesIO(binary[v['byteOffset']:v['byteOffset']+v['byteLength']])).convert('RGB')
 im.thumbnail((1024,1024));out=io.BytesIO();im.save(out,'JPEG',quality=87);v['_replacement']=out.getvalue()
old=bytes(binary);binary=bytearray()
for v in g['bufferViews']:
 chunk=v.pop('_replacement',old[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])
 binary.extend(b'\0'*(-len(binary)%4));v['byteOffset']=len(binary);v['byteLength']=len(chunk);binary.extend(chunk)
binary.extend(b'\0'*(-len(binary)%4));g['buffers'][0]['byteLength']=len(binary)
encoded=json.dumps(g,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
out=Path('public/assets/sword-dark-cmtvomjcx00072etq8bbl9bx3.glb');out.write_bytes(result)
print(out,round(len(result)/1024),'KB',g['accessors'][primitive['indices']]['count']//3,'triangles',a['min'],a['max'])
