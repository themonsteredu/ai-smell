import numpy as np, wave
SR=44100; DUR=52.2; N=int(SR*DUR); t=np.arange(N)/SR
BPM=84; beat=60/BPM; bar=beat*4
def mid(m): return 440*2**((m-69)/12)
# progression: D Bm G A (2 bars each) -> repeats, 따뜻한 장조
prog=[[62,66,69],[59,62,66],[55,59,62],[57,61,64]]
out=np.zeros(N); rng=np.random.default_rng(1)
def env_adsr(n,a,r):
    e=np.ones(n); ai=min(int(a*SR),n//2); ri=min(int(r*SR),n//2)
    e[:ai]=np.linspace(0,1,ai); e[-ri:]*=np.linspace(1,0,ri); return e
# pad
chord_len=bar*2
k=0; start=0.0
while start<DUR:
    ch=prog[k%4]; n=int(min(chord_len+1.0,DUR-start)*SR); s0=int(start*SR)
    tt=np.arange(n)/SR; sig=np.zeros(n)
    for m in ch+[ch[0]-12]:
        f=mid(m)
        for d in (-0.12,0.12):
            ff=f*2**(d/12)
            sig+=np.sin(2*np.pi*ff*tt)+0.25*np.sin(2*np.pi*2*ff*tt)+0.08*np.sin(2*np.pi*3*ff*tt)
    sig*=env_adsr(n,1.2,1.2)*0.035
    out[s0:s0+n]+=sig[:N-s0]; start+=chord_len; k+=1
# arp (8ths), starts at 4.6s
step=beat/2; i=0; tcur=4.2
while tcur<DUR-2.5:
    bi=int((tcur)/chord_len)%4; ch=prog[bi]
    pat=[0,1,2,1,2,0,1,2]; m=ch[pat[i%8]]+12
    n=int(0.6*SR); s0=int(tcur*SR); tt=np.arange(n)/SR; f=mid(m)
    sig=(np.sin(2*np.pi*f*tt)+0.3*np.sin(2*np.pi*2*f*tt))*np.exp(-tt*7)*0.06
    e=min(n,N-s0); out[s0:s0+e]+=sig[:e]; tcur+=step; i+=1
# soft kick + hat from 8.6s to 46.2
tcur=8.6
while tcur<46.2:
    n=int(0.35*SR); s0=int(tcur*SR); tt=np.arange(n)/SR
    f=50+90*np.exp(-tt*28); ph=2*np.pi*np.cumsum(f)/SR
    out[s0:s0+n]+=np.sin(ph)*np.exp(-tt*9)*0.15
    h0=int((tcur+beat/2)*SR); hn=int(0.05*SR)
    if h0+hn<N: out[h0:h0+hn]+=rng.standard_normal(hn)*np.exp(-np.arange(hn)/SR*90)*0.02
    tcur+=beat
# bass
for bi in range(int(DUR/beat)):
    tb=bi*beat
    if tb<8.6 or tb>46.2: continue
    ch=prog[int(tb/chord_len)%4]; f=mid(ch[0]-24)
    n=int(beat*SR*0.95); s0=int(tb*SR); tt=np.arange(n)/SR
    sig=np.sin(2*np.pi*f*tt)*np.minimum(1,tt*60)*np.exp(-tt*2.2)*0.12
    out[s0:s0+n]+=sig[:N-s0]
# riser into outro + impact
fade=np.ones(N); fi=int(1.0*SR); fade[:fi]=np.linspace(0,1,fi); fo=int(3.5*SR); fade[-fo:]=np.linspace(1,0,fo)**1.5
out*=fade
# simple reverb-ish: add delayed copies
for d,g in ((0.23,0.25),(0.41,0.15),(0.67,0.08)):
    di=int(d*SR); out[di:]+=out[:-di]*g
out/=np.max(np.abs(out))*1.12
st=np.stack([out,np.roll(out,int(0.012*SR))],1)
w=wave.open('music.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype('<i2').tobytes()); w.close()
print('ok')
