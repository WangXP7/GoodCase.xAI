"""Create local, compact GLBs with measured grip/axis alignment; preserve provider originals."""
import io,json,struct
from pathlib import Path
import numpy as np
from PIL import Image
# Longsword arrives upside-down and edge-on. Measurements are from the mesh/viewer.
ITEMS=[('sword','single-distinctive-medieval-arming-sword-cmtve0mg.glb',False,0,-.247,-.22,-.47,.49,.25,.075,.04),('greatsword','single-distinctive-medieval-two-handed-l-cmtve136.glb',True,np.pi/2,-.275,-.26,-.68,.83,.32,.075,.04)]
ITEMS.append(('mace','one-compact-medieval-morning-star-mace-w-cmtvedjv.glb',False,0,-.25,-.18,-.40,.42,.22,.22,.18))
for kind,source,flip,yaw,guard,guard_to,bottom,tip,width,blade_width,depth in ITEMS:
 data=(Path('assets')/source).read_bytes();n=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+n]);binary=bytearray(data[28+n:]);a=j['accessors'][1];v=j['bufferViews'][a['bufferView']];pos=np.frombuffer(binary,dtype=np.float32,count=a['count']*3,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,3)
 if flip:pos[:,1]*=-1;pos[:,0]*=-1
 x,z=pos[:,0].copy(),pos[:,2].copy();pos[:,0]=x*np.cos(yaw)+z*np.sin(yaw);pos[:,2]=-x*np.sin(yaw)+z*np.cos(yaw)
 # Local model coordinates are metres, Y blade axis, X edge axis.
 pos[:,1]=np.interp(pos[:,1],[-.5,guard,.5],[bottom,guard_to,tip])
 pos[:,0]*=width/np.ptp(pos[:,0]);pos[:,2]*=depth/np.ptp(pos[:,2])
 # Keep the generated fuller, wear and engraving; fit blade width to contact envelope.
 mask=pos[:,1]>guard_to+.025; factor=min(1,blade_width/np.ptp(pos[mask,0]));pos[mask,0]*=factor
 a['min']=pos.min(0).tolist();a['max']=pos.max(0).tolist()
 # Recalculate normals when loading after the measured coordinate transform.
 for prim in j['meshes'][0]['primitives']:prim['attributes'].pop('NORMAL',None)
 # 1K textures are ample for these small props; no 4K raw provider maps at runtime.
 for image in j['images']:
  v=j['bufferViews'][image['bufferView']];im=Image.open(io.BytesIO(binary[v['byteOffset']:v['byteOffset']+v['byteLength']])).convert('RGB');im.thumbnail((1024,1024));out=io.BytesIO();im.save(out,'JPEG',quality=87);v['_replacement']=out.getvalue()
 old=bytes(binary);binary=bytearray()
 for v in j['bufferViews']:
  chunk=v.pop('_replacement',old[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);binary.extend(b'\0'*(-len(binary)%4));v['byteOffset']=len(binary);v['byteLength']=len(chunk);binary.extend(chunk)
 binary.extend(b'\0'*(-len(binary)%4));j['buffers'][0]['byteLength']=len(binary);encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
 result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
 target=Path('public/assets')/(kind+'.glb');target.write_bytes(result);print(kind,round(len(result)/1024),'KB',j['accessors'][0]['count']//3,'triangles')
