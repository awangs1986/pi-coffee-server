#define _GNU_SOURCE
#include <node_api.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>

static napi_value error(napi_env env,const char *message){napi_throw_error(env,NULL,message);return NULL;}
static int integer(napi_env env,napi_value value,int32_t *out){napi_valuetype type;double original;return napi_typeof(env,value,&type)==napi_ok&&type==napi_number&&napi_get_value_double(env,value,&original)==napi_ok&&napi_get_value_int32(env,value,out)==napi_ok&&original==(double)*out;}
static napi_value lock_file(napi_env env,napi_callback_info info){
 size_t count=2;napi_value args[2],result;int32_t fd,operation;
 if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=2||!integer(env,args[0],&fd)||fd<0||!integer(env,args[1],&operation)||(operation!=LOCK_SH&&operation!=LOCK_EX))return error(env,"Invalid kernel lease arguments");
 int flags=fcntl(fd,F_GETFD);if(flags<0||fcntl(fd,F_SETFD,flags|FD_CLOEXEC)<0)return error(env,"Kernel lease descriptor unavailable");
 int locked=flock(fd,operation|LOCK_NB)==0;
 if(!locked&&errno!=EWOULDBLOCK&&errno!=EAGAIN)return error(env,"Kernel lease operation failed");
 napi_get_boolean(env,locked,&result);return result;
}
static napi_value protection(napi_env env,napi_callback_info info){
 (void)info;napi_value result,value;int dumpable=prctl(PR_GET_DUMPABLE,0,0,0,0),nnp=prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0);
 if(dumpable<0||nnp<0)return error(env,"Process protection query unavailable");
 napi_create_object(env,&result);napi_create_int32(env,dumpable,&value);napi_set_named_property(env,result,"dumpable",value);napi_create_int32(env,nnp,&value);napi_set_named_property(env,result,"noNewPrivs",value);return result;
}
static napi_value harden(napi_env env,napi_callback_info info){
 if(prctl(PR_SET_DUMPABLE,0,0,0,0)!=0||prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)!=0)return error(env,"Process protection unavailable");
 return protection(env,info);
}
static napi_value peer(napi_env env,napi_callback_info info){
 size_t count=1;napi_value arg,result,value;int32_t fd;struct ucred credentials;socklen_t length=sizeof(credentials);
 if(napi_get_cb_info(env,info,&count,&arg,NULL,NULL)!=napi_ok||count!=1||!integer(env,arg,&fd)||fd<0)return error(env,"Invalid peer descriptor");
 if(getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&credentials,&length)!=0||length!=sizeof(credentials))return error(env,"Kernel peer credentials unavailable");
 napi_create_object(env,&result);napi_create_int32(env,credentials.pid,&value);napi_set_named_property(env,result,"pid",value);napi_create_uint32(env,credentials.uid,&value);napi_set_named_property(env,result,"uid",value);napi_create_uint32(env,credentials.gid,&value);napi_set_named_property(env,result,"gid",value);return result;
}
static napi_value initialize(napi_env env,napi_value exports){
 napi_property_descriptor properties[]={{"tryLock",NULL,lock_file,NULL,NULL,NULL,napi_default,NULL},{"protection",NULL,protection,NULL,NULL,NULL,napi_default,NULL},{"harden",NULL,harden,NULL,NULL,NULL,napi_default,NULL},{"peerCredentials",NULL,peer,NULL,NULL,NULL,napi_default,NULL}};
 napi_define_properties(env,exports,sizeof(properties)/sizeof(properties[0]),properties);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
