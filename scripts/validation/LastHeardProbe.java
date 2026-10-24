package br.radio.zapdmr;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
public final class LastHeardProbe {
    public static void main(String[] args) throws Exception {
        AtomicInteger received = new AtomicInteger();
        CountDownLatch first = new CountDownLatch(1);
        BrandMeisterActivityClient client = new BrandMeisterActivityClient((event,data) -> {
            if(event.equals("lastHeard")) System.out.println(data.optString("message"));
            if(event.equals("activity")&&data.optLong("lastActivityAt")>0){
                int count=received.incrementAndGet();
                if(count<=8)System.out.println("Global TG "+data.optInt("talkgroupId")+" "+data.optString("lastCallerCallsign"));
                first.countDown();
            }
        });
        client.watch(new HashSet<>(Arrays.asList(91,724,7242,724013,72422,72425,724907,724941)));
        client.start();
        boolean seen=first.await(30,TimeUnit.SECONDS);
        if(seen)Thread.sleep(3000);
        client.close();
        if(!seen)throw new AssertionError("No real global activity captured within 30 seconds");
        System.out.println("PASS: native Android client captured "+received.get()+" real global activity events on host JVM");
    }
}
